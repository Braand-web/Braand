'use client';
// Short next requests suggested by Braand under a finished answer. One click
// sends the request as the user's next message; they fade in one by one.
import {CornerDownRight} from 'lucide-react';
import type {RichResponse} from '@/lib/rich-response';
import {readableRichBlocks} from '@/lib/rich-response';
import './follow-ups.css';

/** The follow-ups saved with an answer (the last ones win), at most three. */
export function answerFollowUps(responses: RichResponse[] | undefined): string[] {
 const items = (responses || []).flatMap(response => readableRichBlocks(response).flatMap(block => block.type === 'followups' ? block.items : []));
 return [...new Set(items.map(item => item.trim()).filter(Boolean))].slice(-3);
}

export function FollowUps({items, onPick, disabled = false}: {items: string[]; onPick: (text: string) => void; disabled?: boolean}) {
 if (!items.length) return null;
 return <nav className="follow-ups" aria-label="Pour continuer">
  <p>Pour continuer</p>
  <ul>{items.map((text, index) => <li key={text} style={{animationDelay: index * 90 + 'ms'}}>
   <button type="button" disabled={disabled} onClick={() => onPick(text)}><CornerDownRight size={13} aria-hidden="true"/><span>{text}</span></button>
  </li>)}</ul>
 </nav>;
}
