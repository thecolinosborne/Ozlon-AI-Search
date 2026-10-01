import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, Plus, Trash2, Edit, ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────
interface Domain {
  id: string;
  domain: string;
  tld: string;
  registration_expires: string | null;
  statuses: string[] | null;
  auto_renew: boolean;
  locked: boolean;
  customer_id: string;
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  prio?: number;
}

interface CustomerProfile {
  email: string;
  full_name: string;
  phone?: string;
  company?: string;
}

interface NewRecord {
  type: string;
  name: string;
  content: string;
  ttl: number;
  prio: number;
}

// ── Constants ────────────────────────────────────────────────────────────────
const FN_URL = "https://vgicmppmdftaxvoxvdzx.supabase.co/functions/v1/dns-manager";
const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"];

// ── Helpers ──────────────────────────────────────────────────────────────────
async function dnsRequest(
  method: string,
  domain: string,
  recordId?: string,
  body?: object
) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const url = recordId ? `${FN_URL}/${domain}/${recordId}` : `${FN_URL}/${domain}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function getDomainStatus(domain: Domain) {
  const s = (domain.statuses ?? []).join(" ").toLowerCase();
  if (s.includes("active") || s.includes("ok")) return "active";
  if (s.includes("expired")) return "expired";
  return "pending";
}

function formatExpiry(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

const BLANK_RECORD: NewRecord = { type: "A", name: "", content: "", ttl: 300, prio: 0 };

// ── Component ────────────────────────────────────────────────────────────────
export default function Domains() {
  const [profile, setProfile]             = useState<CustomerProfile | null>(null);
  const [domains, setDomains]             = useState<Domain[]>([]);
  const [loading, setLoading]             = useState(true);
  const [expandedDomain, setExpanded]     = useState<string | null>(null);
  const [dnsRecords, setDnsRecords]       = useState<DnsRecord[]>([]);
  const [dnsLoading, setDnsLoading]       = useState(false);
  const [showAdd, setShowAdd]             = useState(false);
  const [newRecord, setNewRecord]         = useState<NewRecord>(BLANK_RECORD);
  const [editingRecord, setEditing]       = useState<DnsRecord | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // ── Load profile + domains on mount ──────────────────────────────────────
  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!prof?.email) return;

      const { data: cust } = await supabase
        .from("customers")
        .select("id, phone, company")
        .eq("email", prof.email)
        .maybeSingle();

      setProfile({
        email: prof.email,
        full_name: prof.full_name ?? "",
        phone: cust?.phone ?? "",
        company: cust?.company ?? "",
      });

      if (cust?.id) {
        const { data: doms } = await supabase
          .from("domains")
          .select("id, domain, tld, registration_expires, statuses, auto_renew, locked, customer_id")
          .eq("customer_id", cust.id)
          .order("created_at", { ascending: false });
        setDomains((doms ?? []) as unknown as Domain[]);
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Load DNS records for a domain ────────────────────────────────────────
  async function loadDns(domainFull: string) {
    setDnsLoading(true);
    setDnsRecords([]);
    try {
      const data = await dnsRequest("GET", domainFull);
      setDnsRecords(data.records ?? []);
      if (data.status === "ERROR") toast.error(data.message ?? "Could not load DNS records");
    } catch (e) {
      toast.error("Failed to connect to DNS manager");
    } finally {
      setDnsLoading(false);
    }
  }

  async function toggleDomain(domainFull: string) {
    if (expandedDomain === domainFull) {
      setExpanded(null);
      setDnsRecords([]);
    } else {
      setExpanded(domainFull);
      await loadDns(domainFull);
    }
  }

  // ── Add record ───────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!expandedDomain || !newRecord.content) return;
    setActionLoading(true);
    try {
      const data = await dnsRequest("POST", expandedDomain, undefined, newRecord);
      if (data.status === "SUCCESS") {
        toast.success("DNS record added");
        setShowAdd(false);
        setNewRecord(BLANK_RECORD);
        await loadDns(expandedDomain);
      } else {
        toast.error(data.message ?? "Failed to add record");
      }
    } finally {
      setActionLoading(false);
    }
  }

  // ── Delete record ─────────────────────────────────────────────────────────
  async function handleDelete(recordId: string) {
    if (!expandedDomain) return;
    try {
      const data = await dnsRequest("DELETE", expandedDomain, recordId);
      if (data.status === "SUCCESS") {
        toast.success("DNS record deleted");
        await loadDns(expandedDomain);
      } else {
        toast.error(data.message ?? "Failed to delete record");
      }
    } catch {
      toast.error("Delete failed");
    }
  }

  // ── Update record ─────────────────────────────────────────────────────────
  async function handleUpdate() {
    if (!expandedDomain || !editingRecord) return;
    setActionLoading(true);
    try {
      const data = await dnsRequest("PUT", expandedDomain, editingRecord.id, {
        type: editingRecord.type,
        name: editingRecord.name,
        content: editingRecord.content,
        ttl: editingRecord.ttl,
        prio: editingRecord.prio ?? 0,
      });
      if (data.status === "SUCCESS") {
        toast.success("DNS record updated");
        setEditing(null);
        await loadDns(expandedDomain);
      } else {
        toast.error(data.message ?? "Failed to update record");
      }
    } finally {
      setActionLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4 space-y-6">

      {/* Account summary */}
      {profile && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Account</CardTitle>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              {profile.full_name && <span className="font-semibold">{profile.full_name}</span>}
              <span className="text-muted-foreground text-sm">{profile.email}</span>
              {profile.company && <Badge variant="secondary">{profile.company}</Badge>}
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Domains */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Domains</CardTitle>
              <CardDescription>View and manage DNS records for your domains</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={loadData} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {domains.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Globe className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No domains registered yet.</p>
            </div>
          ) : (
            domains.map((dom) => {
              const full = `${dom.domain}.${dom.tld}`;
              const status = getDomainStatus(dom);
              const isOpen = expandedDomain === full;

              return (
                <div key={dom.id} className="border rounded-xl overflow-hidden">

                  {/* Domain header row */}
                  <button
                    onClick={() => toggleDomain(full)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div>
                        <p className="font-medium">{full}</p>
                        <p className="text-xs text-muted-foreground">
                          Expires {formatExpiry(dom.registration_expires)}
                          {dom.auto_renew ? " · Auto-renew on" : ""}
                          {dom.locked ? " · Locked" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={status === "active" ? "default" : status === "expired" ? "destructive" : "secondary"}
                        className="text-xs"
                      >
                        {status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">DNS</span>
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>

                  {/* DNS panel */}
                  {isOpen && (
                    <div className="border-t bg-background px-4 py-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">DNS Records</p>
                        <Button size="sm" onClick={() => setShowAdd(true)} className="h-8 gap-1">
                          <Plus className="h-3 w-3" /> Add Record
                        </Button>
                      </div>

                      {dnsLoading ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : dnsRecords.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">No records found.</p>
                      ) : (
                        <div className="rounded-lg border overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-20">Type</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Content</TableHead>
                                <TableHead className="w-20">TTL</TableHead>
                                <TableHead className="w-20 text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {dnsRecords.map((rec) => (
                                <TableRow key={rec.id}>
                                  <TableCell>
                                    <Badge variant="outline" className="font-mono text-xs">{rec.type}</Badge>
                                  </TableCell>
                                  <TableCell className="font-mono text-sm">{rec.name || "@"}</TableCell>
                                  <TableCell className="font-mono text-sm max-w-xs truncate" title={rec.content}>
                                    {rec.content}
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{rec.ttl}s</TableCell>
                                  <TableCell>
                                    <div className="flex justify-end gap-1">
                                      <Button
                                        variant="ghost" size="icon"
                                        className="h-7 w-7"
                                        onClick={() => setEditing(rec)}
                                      >
                                        <Edit className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost" size="icon"
                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => handleDelete(rec.id)}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* ── Add Record Dialog ── */}
      <Dialog open={showAdd} onOpenChange={(o) => { if (!o) { setShowAdd(false); setNewRecord(BLANK_RECORD); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add DNS Record</DialogTitle>
            <DialogDescription>Adding record to <strong>{expandedDomain}</strong></DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={newRecord.type} onValueChange={(v) => setNewRecord(r => ({ ...r, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DNS_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>TTL (sec)</Label>
                <Input
                  type="number"
                  value={newRecord.ttl}
                  onChange={(e) => setNewRecord(r => ({ ...r, ttl: Number(e.target.value) || 300 }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Name <span className="text-muted-foreground text-xs">(@  = root)</span></Label>
              <Input
                placeholder="@ or subdomain"
                value={newRecord.name}
                onChange={(e) => setNewRecord(r => ({ ...r, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Content</Label>
              <Input
                placeholder={newRecord.type === "A" ? "1.2.3.4" : newRecord.type === "CNAME" ? "target.example.com" : "Value"}
                value={newRecord.content}
                onChange={(e) => setNewRecord(r => ({ ...r, content: e.target.value }))}
              />
            </div>
            {newRecord.type === "MX" && (
              <div className="space-y-2">
                <Label>Priority</Label>
                <Input
                  type="number"
                  value={newRecord.prio}
                  onChange={(e) => setNewRecord(r => ({ ...r, prio: Number(e.target.value) || 0 }))}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setShowAdd(false); setNewRecord(BLANK_RECORD); }}>Cancel</Button>
              <Button onClick={handleAdd} disabled={!newRecord.content || actionLoading}>
                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Add Record
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Record Dialog ── */}
      <Dialog open={!!editingRecord} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit DNS Record</DialogTitle>
            <DialogDescription>Updating record on <strong>{expandedDomain}</strong></DialogDescription>
          </DialogHeader>
          {editingRecord && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Input value={editingRecord.type} disabled className="bg-muted font-mono" />
                </div>
                <div className="space-y-2">
                  <Label>TTL (sec)</Label>
                  <Input
                    type="number"
                    value={editingRecord.ttl}
                    onChange={(e) => setEditing(r => r ? { ...r, ttl: Number(e.target.value) || 300 } : null)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editingRecord.name}
                  onChange={(e) => setEditing(r => r ? { ...r, name: e.target.value } : null)}
                />
              </div>
              <div className="space-y-2">
                <Label>Content</Label>
                <Input
                  value={editingRecord.content}
                  onChange={(e) => setEditing(r => r ? { ...r, content: e.target.value } : null)}
                />
              </div>
              {editingRecord.type === "MX" && (
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Input
                    type="number"
                    value={editingRecord.prio ?? 0}
                    onChange={(e) => setEditing(r => r ? { ...r, prio: Number(e.target.value) } : null)}
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={handleUpdate} disabled={actionLoading}>
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
