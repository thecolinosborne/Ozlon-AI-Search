import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type { SourceType, RequestedOutput, AspectRatio } from '@/types/video';
import { SOURCE_TYPE_LABELS, OUTPUT_TYPE_LABELS } from '@/types/video';

interface VideoTaskCreateFormProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    title: string;
    description?: string;
    source_type: SourceType;
    source_content?: string;
    requested_output: RequestedOutput;
    edit_instructions?: string;
    aspect_ratio: AspectRatio;
    target_duration?: number;
  }) => void;
}

export function VideoTaskCreateForm({ open, onClose, onCreate }: VideoTaskCreateFormProps) {
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('prompt');
  const [sourceContent, setSourceContent] = useState('');
  const [requestedOutput, setRequestedOutput] = useState<RequestedOutput>('short_form');
  const [editInstructions, setEditInstructions] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [targetDuration, setTargetDuration] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onCreate({
      title: title.trim(),
      source_type: sourceType,
      source_content: sourceContent.trim() || undefined,
      requested_output: requestedOutput,
      edit_instructions: editInstructions.trim() || undefined,
      aspect_ratio: aspectRatio,
      target_duration: targetDuration ? parseInt(targetDuration) : undefined,
    });
    // Reset
    setTitle('');
    setSourceContent('');
    setEditInstructions('');
    setTargetDuration('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Video Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Product launch reel" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Source Type</Label>
              <Select value={sourceType} onValueChange={v => setSourceType(v as SourceType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Output Type</Label>
              <Select value={requestedOutput} onValueChange={v => setRequestedOutput(v as RequestedOutput)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(OUTPUT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Source Content</Label>
            <Textarea
              value={sourceContent}
              onChange={e => setSourceContent(e.target.value)}
              placeholder="Paste your script, transcript, or prompt..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Aspect Ratio</Label>
              <Select value={aspectRatio} onValueChange={v => setAspectRatio(v as AspectRatio)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">9:16 (Vertical)</SelectItem>
                  <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                  <SelectItem value="1:1">1:1 (Square)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Duration (seconds)</Label>
              <Input
                type="number"
                min="1"
                value={targetDuration}
                onChange={e => setTargetDuration(e.target.value)}
                placeholder="e.g. 30"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Edit Instructions</Label>
            <Textarea
              value={editInstructions}
              onChange={e => setEditInstructions(e.target.value)}
              placeholder="Describe how you want the video edited..."
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!title.trim()}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
