

# Add Tasks to User Menu

The Tasks page exists but is only accessible via the bottom nav bar, which may not be visible on desktop. The fix is to add a "Tasks" menu item to the UserMenu dropdown, placed between "Profile" and "Settings".

## Changes

### `src/components/UserMenu.tsx`
- Import `ClipboardList` from lucide-react
- Add a new `DropdownMenuItem` linking to `/tasks` between the Profile and Settings items:

```tsx
<DropdownMenuItem asChild>
  <Link to="/tasks" className="cursor-pointer">
    <ClipboardList className="w-4 h-4 mr-2" />
    Tasks
  </Link>
</DropdownMenuItem>
```

One file, one change.

