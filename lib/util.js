'use client';
import { supabase } from './supabase';

export function fmtCountdown(ms) {
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function fmtAgo(ts, now = Date.now()) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}

export function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1 min';
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function distM(a, b) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function inZone(pub, zone) {
  if (!zone) return true;
  return distM(pub, { lat: zone.center_lat, lng: zone.center_lng }) <= zone.radius_m;
}

// Shrink a camera photo to ~1280px JPEG so uploads are quick on mobile data
export async function compressImage(file, maxDim = 1280, quality = 0.8) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b || file), 'image/jpeg', quality));
}

export async function uploadPhoto(gameId, teamId, kind, file) {
  const blob = await compressImage(file);
  const path = `${gameId}/${teamId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase().storage.from('photos').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  return path;
}

// Signed URLs for a list of storage paths (private bucket)
export async function signedUrls(paths) {
  const clean = [...new Set(paths.filter(Boolean))];
  if (!clean.length) return {};
  const { data, error } = await supabase().storage.from('photos').createSignedUrls(clean, 60 * 60);
  if (error) return {};
  const out = {};
  for (const d of data) if (d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

// Alert sound + vibration + system notification (when allowed)
let audioCtx;
export function ping(title, body) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    o.frequency.setValueAtTime(660, audioCtx.currentTime + 0.15);
    g.gain.setValueAtTime(0.25, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.5);
  } catch {}
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {}
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(title, { body, icon: '/icon.svg' });
    }
  } catch {}
}

export function askNotifications() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch {}
  // unlock audio on iOS: must happen inside a tap
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch {}
}

// Remember which game this device is in, so the home page can send people back
export function rememberGame(gameId, role) {
  try {
    localStorage.setItem('ftc-last-game', JSON.stringify({ gameId, role }));
  } catch {}
}
export function lastGame() {
  try {
    return JSON.parse(localStorage.getItem('ftc-last-game') || 'null');
  } catch {
    return null;
  }
}

// Distinct, cool-leaning team colours for map routes and team chips
export const TEAM_COLORS = ['#4f7cff', '#22d3b4', '#a274ff', '#ff5a7a', '#38c8f0', '#ff8ad8', '#7be36b', '#ffb347'];
