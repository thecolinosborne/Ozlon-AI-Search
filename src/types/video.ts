export type SourceType = 'prompt' | 'transcript' | 'script' | 'blog_post' | 'video_url' | 'notes';
export type RequestedOutput = 'short_form' | 'promo' | 'highlight_clips' | 'talking_head' | 'custom';
export type EditPlanStatus = 'not_generated' | 'generated' | 'approved' | 'stale';
export type AspectRatio = '16:9' | '9:16' | '1:1';
export type RenderStatus = 'pending' | 'queued' | 'rendering' | 'completed' | 'failed';

export interface EditPlanAction {
  id: string;
  action_type: string;
  label: string;
  detail: string;
  phase: 'pre' | 'main' | 'post';
  status: 'pending' | 'done' | 'skipped';
}

export interface RenderHistoryEntry {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: 'queued' | 'rendering' | 'completed' | 'failed';
  output_url: string | null;
  error: string | null;
}

export interface VideoTask {
  id: string;
  work_task_id: string;
  user_id: string;
  source_type: SourceType;
  source_content: string | null;
  source_asset_url: string | null;
  requested_output: RequestedOutput;
  edit_instructions: string | null;
  edit_plan: EditPlanAction[];
  edit_plan_status: EditPlanStatus;
  aspect_ratio: AspectRatio;
  target_duration: number | null;
  render_status: RenderStatus;
  render_progress: number;
  output_url: string | null;
  thumbnail_url: string | null;
  render_history: RenderHistoryEntry[];
  created_at: string;
  updated_at: string;
}

export interface VideoTaskWithParent extends VideoTask {
  parent_title: string;
  parent_status: string;
  parent_ai_status: string;
  parent_ai_activity_log: unknown[];
}

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  prompt: 'Prompt',
  transcript: 'Transcript',
  script: 'Script',
  blog_post: 'Blog Post',
  video_url: 'Video URL',
  notes: 'Notes',
};

export const OUTPUT_TYPE_LABELS: Record<RequestedOutput, string> = {
  short_form: 'Short Form',
  promo: 'Promo',
  highlight_clips: 'Highlight Clips',
  talking_head: 'Talking Head',
  custom: 'Custom',
};

export const RENDER_STATUS_LABELS: Record<RenderStatus, string> = {
  pending: 'Pending',
  queued: 'Queued',
  rendering: 'Rendering',
  completed: 'Completed',
  failed: 'Failed',
};

export const RENDER_STATUS_COLORS: Record<RenderStatus, string> = {
  pending: 'text-muted-foreground',
  queued: 'text-primary',
  rendering: 'text-warning',
  completed: 'text-green-500',
  failed: 'text-destructive',
};

export const EDIT_PLAN_STATUS_LABELS: Record<EditPlanStatus, string> = {
  not_generated: 'Not Generated',
  generated: 'Ready for Review',
  approved: 'Approved',
  stale: 'Needs Revision',
};
