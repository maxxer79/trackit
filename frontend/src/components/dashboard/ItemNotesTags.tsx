import { useState } from 'react';
import { useUpdateTracking } from '../../hooks/useProducts';

interface Props {
  productId: string;
  note?: string | null;
  tags?: string[];
}

export default function ItemNotesTags({ productId, note, tags = [] }: Props) {
  const update = useUpdateTracking();
  const [editingNote, setEditingNote] = useState(false);
  const [draft, setDraft] = useState(note ?? '');
  const [tagInput, setTagInput] = useState('');

  const saveTags = (next: string[]) => {
    const cleaned = [...new Set(next.map((t) => t.trim()).filter(Boolean))].slice(0, 20);
    update.mutate({ productId, tags: cleaned });
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (!tags.includes(t)) saveTags([...tags, t]);
    setTagInput('');
  };

  const removeTag = (t: string) => saveTags(tags.filter((x) => x !== t));

  const saveNote = () => {
    update.mutate({ productId, note: draft.trim() || null });
    setEditingNote(false);
  };

  return (
    <div className="mt-2 pt-2 border-t border-dark-separator/60">
      {/* Tags */}
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-caption2 px-2 py-0.5 rounded-pill bg-apple-blue/10 text-apple-blue">
            {t}
            <button onClick={() => removeTag(t)} className="hover:text-apple-red" title="Remove tag" aria-label={`Remove ${t}`}>×</button>
          </span>
        ))}
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
          }}
          onBlur={addTag}
          placeholder="+ tag"
          className="text-caption2 bg-transparent border-none outline-none text-dark-label2 placeholder:text-dark-label3 w-16 focus:w-24 transition-all"
        />
      </div>

      {/* Note */}
      {editingNote ? (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={2000}
            autoFocus
            placeholder="Private note (only you can see this)…"
            className="input w-full text-caption1 resize-none"
          />
          <div className="flex gap-2 mt-1">
            <button onClick={saveNote} className="text-caption2 text-apple-blue font-semibold hover:underline">Save</button>
            <button onClick={() => { setDraft(note ?? ''); setEditingNote(false); }} className="text-caption2 text-dark-label3 hover:underline">Cancel</button>
          </div>
        </div>
      ) : note ? (
        <button
          onClick={() => { setDraft(note); setEditingNote(true); }}
          className="mt-1.5 block text-left text-caption1 text-dark-label2 hover:text-dark-label1 whitespace-pre-wrap"
          title="Edit note"
        >
          📝 {note}
        </button>
      ) : (
        <button
          onClick={() => { setDraft(''); setEditingNote(true); }}
          className="mt-1.5 text-caption2 text-dark-label3 hover:text-apple-blue"
        >
          + Add note
        </button>
      )}
    </div>
  );
}
