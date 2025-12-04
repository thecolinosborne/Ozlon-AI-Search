import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ArrowLeft, CreditCard, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    features: ["5 queries per day", "Basic agents", "Email support"],
    current: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19",
    period: "per month",
    features: [
      "Unlimited queries",
      "All agents unlocked",
      "Priority support",
      "Custom integrations",
      "API access",
    ],
    current: false,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    period: "contact us",
    features: [
      "Everything in Pro",
      "Dedicated support",
      "Custom agents",
      "SLA guarantee",
      "On-premise option",
    ],
    current: false,
  },
];

const Billing = () => {
  const navigate = useNavigate();
  const { authLoading, session, user } = useAuth();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  // Redirect to auth if not signed in
  useEffect(() => {
    if (!authLoading && (!session || !user)) {
      navigate("/auth");
    }
  }, [authLoading, session, user, navigate]);

  const handleUpgrade = (planId: string) => {
    setSelectedPlan(planId);
    setShowUpgradeModal(true);
  };

  const handleContactSales = () => {
    setShowContactModal(true);
  };

  const handleAddPaymentMethod = () => {
    toast.info("Payment method setup coming soon. Please contact support.");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!session || !user) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div>
            <h1 className="text-lg font-medium text-foreground">Billing</h1>
            <p className="text-xs text-muted-foreground">Manage your subscription</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Current Plan */}
        <div className="mb-8 p-6 bg-card rounded-2xl border border-border">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="w-5 h-5 text-muted-foreground" />
            <h2 className="font-medium text-foreground">Current Plan</h2>
          </div>
          <p className="text-2xl font-light text-foreground mb-1">Free</p>
          <p className="text-sm text-muted-foreground">
            You're on the free plan with limited features
          </p>
        </div>

        {/* Plans */}
        <h3 className="text-lg font-medium text-foreground mb-4">Choose a plan</h3>
        <div className="grid md:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                "p-6 rounded-2xl border-2 transition-all",
                plan.current
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              )}
            >
              <h4 className="font-medium text-foreground mb-1">{plan.name}</h4>
              <div className="mb-4">
                <span className="text-2xl font-light text-foreground">{plan.price}</span>
                <span className="text-sm text-muted-foreground ml-1">/{plan.period}</span>
              </div>
              <ul className="space-y-2 mb-6">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-green-600" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => {
                  if (plan.current) return;
                  if (plan.id === "enterprise") {
                    handleContactSales();
                  } else {
                    handleUpgrade(plan.id);
                  }
                }}
                disabled={plan.current}
                className={cn(
                  "w-full py-2.5 rounded-full text-sm font-medium transition-colors",
                  plan.current
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {plan.current ? "Current plan" : plan.id === "enterprise" ? "Contact sales" : "Upgrade"}
              </button>
            </div>
          ))}
        </div>

        {/* Payment Methods */}
        <div className="mt-12">
          <h3 className="text-lg font-medium text-foreground mb-4">Payment methods</h3>
          <div className="p-6 border border-border rounded-2xl text-center">
            <p className="text-muted-foreground mb-4">No payment methods added</p>
            <button
              onClick={handleAddPaymentMethod}
              className={cn(
                "px-6 py-2.5 rounded-full text-sm font-medium",
                "border border-border text-foreground",
                "hover:bg-muted transition-colors"
              )}
            >
              Add payment method
            </button>
          </div>
        </div>
      </main>

      {/* Upgrade Modal */}
      <Dialog open={showUpgradeModal} onOpenChange={setShowUpgradeModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upgrade to Pro</DialogTitle>
            <DialogDescription>
              Get unlimited queries, all agents, and priority support for $19/month.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Payment integration is coming soon. Please contact our support team to upgrade your account.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  window.open("mailto:support@ozlon.ai?subject=Pro%20Plan%20Upgrade", "_blank");
                  setShowUpgradeModal(false);
                }}
                className="flex-1 py-2.5 rounded-full text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                Contact Support
                <ExternalLink className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="px-4 py-2.5 rounded-full text-sm font-medium border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Contact Sales Modal */}
      <Dialog open={showContactModal} onOpenChange={setShowContactModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contact Sales</DialogTitle>
            <DialogDescription>
              Get a custom enterprise plan tailored to your organization's needs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Our enterprise team will help you set up custom agents, dedicated support, and more.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  window.open("mailto:enterprise@ozlon.ai?subject=Enterprise%20Plan%20Inquiry", "_blank");
                  setShowContactModal(false);
                }}
                className="flex-1 py-2.5 rounded-full text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                Email Sales Team
                <ExternalLink className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowContactModal(false)}
                className="px-4 py-2.5 rounded-full text-sm font-medium border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Billing;
