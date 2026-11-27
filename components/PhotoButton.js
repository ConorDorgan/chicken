'use client';
import { useRef, useState } from 'react';

// Opens the phone's camera directly (capture="environment") and hands back the file.
export default function PhotoButton({ label, onPhoto, disabled, className = 'btn btn-primary' }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  async function onChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await onPhoto(file);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className={className} disabled={disabled || busy} onClick={() => input.current?.click()}>
        {busy ? 'Uploading…' : `📷 ${label}`}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={onChange}
      />
    </>
  );
}
