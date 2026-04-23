import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useEffect } from "react";
import { Bold, Italic, List, ListOrdered, Link as LinkIcon, Quote } from "lucide-react";
import { cn } from "@/lib/utils";

interface RichEmailEditorProps {
  value: string;
  onChange: (html: string, text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function RichEmailEditor({ value, onChange, placeholder, disabled }: RichEmailEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value || "<p></p>",
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[160px] focus:outline-none px-3 py-2 text-[14px] leading-relaxed",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML(), editor.getText());
    },
  });

  // Sync external value (e.g. AI regenerate) without losing focus on user typing
  useEffect(() => {
    if (!editor) return;
    if (value && value !== editor.getHTML()) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) return null;

  const Btn = ({
    active,
    onClick,
    label,
    children,
  }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode }) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card transition-colors",
        active && "bg-primary/15 text-primary",
      )}
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-2xl bg-card/60 border border-border/30 backdrop-blur-xl overflow-hidden">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-border/20">
        <Btn label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="w-3.5 h-3.5" />
        </Btn>
        <Btn label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="w-3.5 h-3.5" />
        </Btn>
        <span className="w-px h-4 bg-border/40 mx-0.5" />
        <Btn
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="w-3.5 h-3.5" />
        </Btn>
        <Btn
          label="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </Btn>
        <Btn
          label="Quote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="w-3.5 h-3.5" />
        </Btn>
        <Btn
          label="Link"
          active={editor.isActive("link")}
          onClick={() => {
            const prev = editor.getAttributes("link").href as string | undefined;
            const url = window.prompt("URL", prev ?? "https://");
            if (url === null) return;
            if (url === "") {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              return;
            }
            editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          }}
        >
          <LinkIcon className="w-3.5 h-3.5" />
        </Btn>
      </div>
      <EditorContent editor={editor} />
      {editor.isEmpty && placeholder ? (
        <div className="pointer-events-none -mt-[calc(100%+1rem)] px-3 py-2 text-[14px] text-muted-foreground/60 select-none">
          {placeholder}
        </div>
      ) : null}
    </div>
  );
}
