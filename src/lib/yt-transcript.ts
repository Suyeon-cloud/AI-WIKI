/**
 * YouTube 자막 → 타임스탬프가 있는 Markdown 노트 (로컬 yt-dlp 스크립트와 앱이 함께 쓰는 순수 함수).
 * - 자막 선택: 수동 자막 우선, 없으면 자동 자막 (원어 자동 자막 우선)
 * - VTT 정리: 태그·엔티티 제거, 자동 자막의 '굴러가는' 중복 줄 제거, 30초 단위 문단
 * - 노트 frontmatter는 기존 Markdown 가져오기가 그대로 읽는 키만 쓴다
 */

export type TrackKind = 'manual' | 'auto';
export interface YtTrackInfo {
  ext?: string;
  url?: string;
  name?: string;
}
/** yt-dlp -J 결과 중 쓰는 항목 */
export interface YtInfo {
  id: string;
  title?: string;
  channel?: string;
  uploader?: string;
  upload_date?: string; // YYYYMMDD
  language?: string | null;
  webpage_url?: string;
  subtitles?: Record<string, YtTrackInfo[]>;
  automatic_captions?: Record<string, YtTrackInfo[]>;
}
export interface PickedTrack {
  lang: string; // yt-dlp 언어 코드 (예: ko, en-US, ko-orig)
  kind: TrackKind;
  /** 자동 번역 자막 (원어가 아닌 자동 자막) */
  translated: boolean;
}

export class TranscriptError extends Error {
  constructor(
    public code: 'no-ytdlp' | 'bad-url' | 'unavailable' | 'blocked' | 'rate-limited' | 'network' | 'no-subtitles' | 'empty' | 'exists' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
export const isYoutubeId = (s: string | undefined): s is string => !!s && YT_ID.test(s);
export const youtubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

const usable = (tracks: YtTrackInfo[] | undefined) => !!tracks?.length;
const baseLang = (code: string) => code.toLowerCase().replace(/-orig$/, '').split('-')[0];

/** 수동 자막(요청 언어 순) → 원어 자동 자막 → 요청 언어 자동 자막(번역) 순으로 고른다 */
export function pickTrack(info: Pick<YtInfo, 'subtitles' | 'automatic_captions' | 'language'>, langs: string[]): PickedTrack | undefined {
  const want = langs.map((l) => l.toLowerCase());
  const manual = Object.keys(info.subtitles ?? {}).filter((k) => k !== 'live_chat' && usable(info.subtitles![k]));
  for (const l of want) {
    const hit = manual.find((k) => k.toLowerCase() === l) ?? manual.find((k) => baseLang(k) === l);
    if (hit) return { lang: hit, kind: 'manual', translated: false };
  }
  const auto = Object.keys(info.automatic_captions ?? {}).filter((k) => usable(info.automatic_captions![k]));
  const orig = info.language ? baseLang(info.language) : undefined;
  // 원어 자동 자막: '-orig' 표시가 있거나, 영상 언어와 같은 코드
  for (const l of want) {
    const hit = auto.find((k) => k.toLowerCase() === `${l}-orig`) ?? (orig === l ? auto.find((k) => baseLang(k) === l) : undefined);
    if (hit) return { lang: hit, kind: 'auto', translated: false };
  }
  for (const l of want) {
    const hit = auto.find((k) => k.toLowerCase() === l);
    if (hit) return { lang: hit, kind: 'auto', translated: !!orig && orig !== l };
  }
  return undefined;
}

/* ───────── VTT ───────── */

export interface Cue {
  start: number;
  end: number;
  lines: string[];
}

const toSec = (t: string) => {
  const p = t.trim().split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const cleanCueText = (s: string) =>
  s
    .replace(/<[^>]*>/g, '') // <c>, <00:00:01.360>, <i> 등
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      ENTITIES[e.toLowerCase()] ?? (e.startsWith('#x') ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : m),
    )
    .replace(/\s+/g, ' ')
    .trim();

export function parseVtt(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const b of blocks) {
    const lines = b.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue; // WEBVTT 머리말, NOTE, STYLE
    const m = lines[ti].match(/^\s*([\d:.]+)\s*-->\s*([\d:.]+)/);
    if (!m) continue;
    const textLines = lines.slice(ti + 1).map(cleanCueText).filter(Boolean);
    if (textLines.length) cues.push({ start: toSec(m[1]), end: toSec(m[2]), lines: textLines });
  }
  return cues;
}

export interface Segment {
  start: number;
  text: string;
}

/** 이 시간 이내로 붙어 있으면 '이어지는' 큐로 본다 (초) */
const JOIN = 0.05;

/**
 * 표시용 중복만 지우고 실제 반복 발화는 남긴다 (수동·자동 자막 공통).
 * 지우는 경우
 *  1) 전환 큐: 0.05초 미만이고 앞 큐에 이미 있던 줄뿐인 큐 (자동 자막의 10ms 큐)
 *  2) 시간이 겹치는 큐: 앞 큐가 끝나기 전에 시작한 큐에서, 앞 큐에 있던 줄
 *  3) 굴러가는 줄: 앞 큐에 바로 이어진 큐가 앞 큐의 마지막 줄(들)로 시작하고 그 뒤에 새 줄이 붙은 경우의 앞부분
 * 남기는 경우: 앞 큐와 똑같은 줄만 있는 큐(새 줄 없음) — 시간이 겹치지 않으면 화자가 다시 말한 것으로 본다
 */
export function dedupeCues(cues: Cue[]): Segment[] {
  const out: Segment[] = [];
  let prev: Cue | undefined;
  for (const c of cues) {
    if (prev && c.end - c.start < JOIN && c.lines.every((l) => prev!.lines.includes(l))) continue; // 1)
    let lines = c.lines;
    if (prev) {
      if (c.start < prev.end - JOIN) {
        lines = lines.filter((l) => !prev!.lines.includes(l)); // 2)
      } else if (c.start - prev.end <= JOIN) {
        // 3) 앞 큐 끝부분과 이 큐 앞부분이 겹치는 줄 수 (새 줄이 뒤에 있을 때만 겹침으로 본다)
        let k = Math.min(prev.lines.length, lines.length - 1);
        while (k > 0 && !lines.slice(0, k).every((l, i) => l === prev!.lines[prev!.lines.length - k + i])) k--;
        lines = lines.slice(k);
      }
    }
    for (const l of lines) out.push({ start: c.start, text: l });
    prev = c;
  }
  return out;
}

export const formatTime = (sec: number) => {
  const s = Math.floor(sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hh ? `${hh}:${two(mm)}:${two(ss)}` : `${two(mm)}:${two(ss)}`;
};

/** 30초(기본) 단위로 묶은 `[mm:ss] 문장…` 문단 */
export function groupSegments(segs: Segment[], windowSec = 30): string[] {
  const paras: string[] = [];
  let start = -1;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) paras.push(`[${formatTime(start)}] ${buf.join(' ')}`);
    buf = [];
  };
  for (const s of segs) {
    if (start < 0 || s.start - start >= windowSec) {
      flush();
      start = s.start;
    }
    buf.push(s.text);
  }
  flush();
  return paras;
}

/* ───────── Markdown 노트 ───────── */

const yamlStr = (s: string) => JSON.stringify(s); // 큰따옴표 문자열 (YAML 호환)
export const uploadDate = (d: string | undefined) => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : undefined);
export const KIND_LABEL: Record<TrackKind, string> = { manual: '수동 자막', auto: '자동 생성 자막' };
export const TRANSCRIPT_HEADING = '## 자막';

export function transcriptFileName(info: Pick<YtInfo, 'id' | 'title'>) {
  const t = (info.title ?? 'YouTube').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${t || 'YouTube'} [${info.id}].md`;
}

export function buildTranscriptNote(info: YtInfo, track: PickedTrack, paragraphs: string[], extractedAt: Date) {
  if (!isYoutubeId(info.id)) throw new TranscriptError('bad-url', '영상 ID를 확인할 수 없습니다.');
  if (!paragraphs.length) throw new TranscriptError('empty', '자막 파일에 글자가 없습니다.');
  const title = info.title?.trim() || `YouTube 영상 (${info.id})`;
  const channel = (info.channel || info.uploader || '').trim();
  const date = uploadDate(info.upload_date);
  const day = extractedAt.toISOString().slice(0, 10);
  const kindText = `${KIND_LABEL[track.kind]}${track.translated ? '(자동 번역)' : ''}`;
  const fm = [
    '---',
    `title: ${yamlStr(title)}`,
    'source_type: YouTube',
    `url: ${youtubeWatchUrl(info.id)}`,
    `youtube_id: ${info.id}`,
    'ref_type: video',
    channel && `author: ${yamlStr(channel)}`,
    'container: YouTube',
    date && `published: ${date}`,
    `accessed: ${day}`,
    `transcript_kind: ${track.kind}`,
    `transcript_lang: ${track.lang}`,
    track.translated && 'transcript_translated: true',
    'transcript_source: yt-dlp',
    'tags:',
    '  - youtube',
    '  - transcript',
    '---',
  ].filter(Boolean);
  const body = [
    `# ${title}`,
    '',
    `- 채널: ${channel || '확인 안 됨'}`,
    `- 게시일: ${date ?? '확인 안 됨'}`,
    `- 자막: ${kindText} · ${track.lang} · yt-dlp로 ${day} 추출`,
    '',
    TRANSCRIPT_HEADING,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
  ];
  return { fileName: transcriptFileName(info), text: `${fm.join('\n')}\n${body.join('\n').trimEnd()}\n` };
}

/* ───────── yt-dlp 오류 → 안내 ───────── */

export function ytdlpError(stderr: string): TranscriptError {
  const s = stderr;
  if (/Unsupported URL|is not a valid URL|Incomplete YouTube ID/i.test(s)) return new TranscriptError('bad-url', 'YouTube 영상 주소가 아닙니다. URL을 확인하세요.');
  if (/Private video|Video unavailable|This video has been removed|members-only|This video is not available/i.test(s))
    return new TranscriptError('unavailable', '비공개·삭제되었거나 볼 수 없는 영상입니다.');
  if (/Sign in to confirm|confirm your age|age-restricted|cookies|login required/i.test(s))
    return new TranscriptError('blocked', 'YouTube가 로그인 확인을 요구해 자막을 받지 못했습니다. --cookies-from-browser 옵션(예: chrome)으로 다시 시도하세요.');
  if (/HTTP Error 429|Too Many Requests/i.test(s)) return new TranscriptError('rate-limited', 'YouTube 요청 한도(429)에 걸렸습니다. 잠시 뒤 다시 시도하세요.');
  if (/Unable to download|getaddrinfo|timed out|Connection|network/i.test(s)) return new TranscriptError('network', '네트워크 문제로 영상 정보를 받지 못했습니다.');
  const last = s.split(/\r?\n/).filter((l) => /ERROR/.test(l)).pop() ?? s.trim().split(/\r?\n/).pop() ?? '';
  return new TranscriptError('failed', `yt-dlp 실행 실패: ${last.replace(/^.*ERROR:\s*/, '').slice(0, 200) || '알 수 없는 오류'}`);
}
