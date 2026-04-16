

# Auto-configure Google Drive URLs in YouTube Upload Form

## What
When a user pastes a Google Drive share link into the "Video URL" field on the YouTube integration page, automatically convert it to a direct download URL with `confirm=t` for large file support.

## Changes

### 1. Frontend: `src/pages/integrations/YouTubeDetail.tsx`
- Add a helper function `normalizeVideoUrl(url)` that detects Google Drive patterns and rewrites them
- Call it in the `onChange` handler (or `onBlur`) of the video URL input so the field auto-updates
- Show a small info note below the input when a Drive link was auto-converted

### 2. Backend: `supabase/functions/youtube/index.ts` (line 701)
- Add `&confirm=t` to the converted Drive URL to bypass the virus scan warning page for large files:
  ```
  videoUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${driveId}`;
  ```

## Frontend helper logic
```typescript
function normalizeVideoUrl(url: string): string {
  const driveFileMatch = url.match(/drive\.google\.com\/file\/d\/([^\/]+)/);
  const driveOpenMatch = !driveFileMatch && url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  const driveId = driveFileMatch?.[1] || driveOpenMatch?.[1];
  if (driveId) {
    return `https://drive.google.com/uc?export=download&confirm=t&id=${driveId}`;
  }
  return url;
}
```

Called on paste/blur of the video URL input, with a toast or subtle label confirming the conversion.

