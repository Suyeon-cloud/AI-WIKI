/**
 * YouTube 영상 자막 → AI WIKI용 Markdown 노트 (로컬 PC에서 yt-dlp 사용)
 * 사용: npm run yt:transcript -- <YouTube URL 또는 영상 ID> [--lang ko,en] [--out 폴더] [--cookies-from-browser chrome] [--force]
 *  - Windows에서 '&'가 든 URL은 따옴표로 감싸거나 영상 ID(11자)만 넣는다.
 *  - 수동 자막을 먼저 찾고, 없으면 자동 생성 자막(원어 우선)을 받는다. 영상은 내려받지 않는다.
 *  - 결과 .md는 AI WIKI '자료 수집 → 파일' 가져오기 또는 '연구 설정 → YouTube 자막 보완'에 쓴다.
 *  - 종료 코드: 0 성공 · 2 자막 없음 · 3 볼 수 없음/로그인 필요/요청 한도 · 1 그 밖의 오류
 * 검증용: --yt-dlp <경로>로 다른 실행 파일(.mjs/.js면 node로 실행)을 지정할 수 있다.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { extractYouTubeId } from '../src/lib/utils';
import {
  KIND_LABEL,
  TranscriptError,
  buildTranscriptNote,
  dedupeCues,
  groupSegments,
  isYoutubeId,
  parseVtt,
  pickTrack,
  youtubeWatchUrl,
  ytdlpError,
  type YtInfo,
} from '../src/lib/yt-transcript';

function args(argv: string[]) {
  const o: { url?: string; langs: string[]; out: string; cookies?: string; bin: string; force: boolean } = {
    langs: ['ko', 'en'],
    out: '.',
    bin: process.env.YTDLP ?? 'yt-dlp',
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang') o.langs = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') o.out = argv[++i] ?? '.';
    else if (a === '--cookies-from-browser') o.cookies = argv[++i];
    else if (a === '--yt-dlp') o.bin = argv[++i] ?? o.bin;
    else if (a === '--force') o.force = true;
    else if (!a.startsWith('--') && !o.url) o.url = a;
    else throw new TranscriptError('failed', `알 수 없는 옵션: ${a}`);
  }
  return o;
}

function run(bin: string, argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const [cmd, pre] = /\.(mjs|cjs|js)$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
  return new Promise((ok, fail) => {
    execFile(cmd, [...pre, ...argv], { maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
      if (e && e.code === 'ENOENT')
        return fail(new TranscriptError('no-ytdlp', 'yt-dlp를 찾을 수 없습니다. 설치 후 다시 시도하세요 (예: winget install yt-dlp.yt-dlp).'));
      ok({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function main() {
  const o = args(process.argv.slice(2));
  if (!o.url) throw new TranscriptError('bad-url', '사용법: npm run yt:transcript -- <YouTube URL> [--lang ko,en] [--out 폴더] [--cookies-from-browser chrome]');
  // Windows의 npm(cmd)은 URL의 '&' 뒤를 잘라 따옴표가 남을 수 있어, 영상 ID만 넣거나 ID 패턴으로도 찾는다
  const raw = o.url.replace(/^["']|["']$/g, '');
  const id = isYoutubeId(raw) ? raw : extractYouTubeId(raw) ?? raw.match(/(?:[?&]v=|youtu\.be\/|\/(?:shorts|embed|live)\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/)?.[1] ?? null;
  if (!id) throw new TranscriptError('bad-url', 'YouTube 영상 주소에서 영상 ID를 찾지 못했습니다.');
  const url = youtubeWatchUrl(id);
  const cookie = o.cookies ? ['--cookies-from-browser', o.cookies] : [];

  // 1) 영상 정보·자막 목록 (영상은 받지 않음)
  const meta = await run(o.bin, ['-J', '--skip-download', '--no-warnings', '--no-playlist', ...cookie, url]);
  if (meta.code !== 0) throw ytdlpError(meta.stderr);
  let info: YtInfo;
  try {
    info = JSON.parse(meta.stdout) as YtInfo;
  } catch {
    throw new TranscriptError('failed', 'yt-dlp가 영상 정보를 JSON으로 돌려주지 않았습니다.');
  }
  const track = pickTrack(info, o.langs);
  if (!track) {
    const m = Object.keys(info.subtitles ?? {}).filter((k) => k !== 'live_chat');
    throw new TranscriptError(
      'no-subtitles',
      `요청한 언어(${o.langs.join(', ')})의 자막이 없습니다. 수동 자막 언어: ${m.join(', ') || '없음'} · 자동 자막: ${Object.keys(info.automatic_captions ?? {}).length ? '있음(다른 언어)' : '없음'}. --lang으로 언어를 바꿔 보세요.`,
    );
  }

  // 2) 고른 자막 한 개만 VTT로 받기
  const tmp = mkdtempSync(join(tmpdir(), 'ai-wiki-yt-'));
  try {
    const sub = await run(o.bin, [
      '--skip-download', '--no-warnings', '--no-playlist',
      track.kind === 'manual' ? '--write-subs' : '--write-auto-subs',
      '--sub-langs', track.lang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      '--sub-format', 'vtt/best', '--convert-subs', 'vtt',
      '-o', join(tmp, '%(id)s.%(ext)s'),
      ...cookie, url,
    ]);
    if (sub.code !== 0) throw ytdlpError(sub.stderr);
    const vtt = readdirSync(tmp).find((f) => f.endsWith('.vtt'));
    if (!vtt) throw new TranscriptError('no-subtitles', '자막 파일을 받지 못했습니다 (YouTube가 자막을 제공하지 않거나 차단했을 수 있음).');
    const paragraphs = groupSegments(dedupeCues(parseVtt(readFileSync(join(tmp, vtt), 'utf8'))));
    const note = buildTranscriptNote(info, track, paragraphs, new Date());

    // 3) 저장 (같은 파일이 있으면 덮어쓰지 않음)
    const path = resolve(o.out, note.fileName);
    if (existsSync(path) && !o.force) throw new TranscriptError('exists', `이미 있는 파일입니다: ${path} (덮어쓰려면 --force)`);
    writeFileSync(path, note.text, { encoding: 'utf8', flag: o.force ? 'w' : 'wx' });
    console.log(`자막 노트 생성: ${path}`);
    console.log(`  ${KIND_LABEL[track.kind]}${track.translated ? '(자동 번역)' : ''} · ${track.lang} · 문단 ${paragraphs.length}개 · ${note.text.length.toLocaleString()}자`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  if (e instanceof TranscriptError) {
    console.error(`오류(${e.code}): ${e.message}`);
    process.exit(e.code === 'no-subtitles' || e.code === 'empty' ? 2 : e.code === 'unavailable' || e.code === 'blocked' || e.code === 'rate-limited' ? 3 : 1);
  }
  console.error(e);
  process.exit(1);
});
