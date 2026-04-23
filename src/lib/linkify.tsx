import { Fragment, type ReactNode } from "react";

// Matches:
//  1. Slack-style <url|label> or <url>
//  2. Bare emails
//  3. http(s)://… URLs (and bare www.…)
const TOKEN_RE =
  /<(https?:\/\/[^|>\s]+)(?:\|([^>]+))?>|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)]['"])/g;

const MAX_DISPLAY = 48;

function truncateUrl(url: string): string {
  if (url.length <= MAX_DISPLAY) return url;
  // Middle ellipsis: keep start (~scheme + host) and tail
  const head = Math.ceil((MAX_DISPLAY - 1) * 0.6);
  const tail = MAX_DISPLAY - 1 - head;
  return `${url.slice(0, head)}…${url.slice(url.length - tail)}`;
}

function ensureScheme(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `https://${href}`;
}

interface LinkifyProps {
  text: string;
  className?: string;
}

export function Linkify({ text, className }: LinkifyProps) {
  if (!text) return null;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  // Reset regex state since it's global.
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    const [full, slackUrl, slackLabel, email, url] = match;
    if (match.index > lastIndex) {
      nodes.push(
        <Fragment key={`t-${key++}`}>{text.slice(lastIndex, match.index)}</Fragment>,
      );
    }

    if (slackUrl) {
      const display = slackLabel?.trim() || truncateUrl(slackUrl);
      nodes.push(
        <a
          key={`l-${key++}`}
          href={slackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {display}
        </a>,
      );
    } else if (email) {
      nodes.push(
        <a
          key={`l-${key++}`}
          href={`mailto:${email}`}
          className="text-primary underline-offset-2 hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {email}
        </a>,
      );
    } else if (url) {
      const href = ensureScheme(url);
      nodes.push(
        <a
          key={`l-${key++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {truncateUrl(url)}
        </a>,
      );
    }

    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`t-${key++}`}>{text.slice(lastIndex)}</Fragment>);
  }

  return <span className={className}>{nodes}</span>;
}
