'use client';
import { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Opens the phone's camera directly (capture="environment") and hands back the file.
export default function PhotoButton({ label, onPhoto, disabled, variant = 'chicken', size = 'lg', block = true }) {
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
      <Button variant={variant} size={size} block={block} disabled={disabled || busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Camera aria-hidden />}
        {busy ? 'Uploading…' : label}
      </Button>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={onChange} />
    </>
  );
}
