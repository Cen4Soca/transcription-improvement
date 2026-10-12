import type { ReactNode } from 'react';

/**
 * Splits text by search query matches and wraps matches in <mark> elements.
 * Uses case-insensitive matching. Does NOT use innerHTML or dangerouslySetInnerHTML.
 * Requirements: 6.2, 14.20
 */
export function highlightText(text: string, query: string): ReactNode {
  if (!query) {
    return text;
  }

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = text.split(regex);

  if (parts.length === 1) {
    return text;
  }

  return parts.map((part, index) => {
    if (part.toLowerCase() === query.toLowerCase()) {
      return (
        <mark key={index} className="bg-yellow-200 rounded-sm">
          {part}
        </mark>
      );
    }
    return part;
  });
}
