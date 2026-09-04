/**
 * s2r:// 是 Source 2 的资源协议，引用的是「编译产物」路径，而磁盘上放的是
 * 源文件，所以解析要同时做两件事：定位内容根、把编译后缀映射回源后缀。
 *
 * core 不碰文件系统：存在性判断由调用方以谓词注入。理由与禁止依赖 vscode 模块
 * 相同——这层要能搬进 LSP、CLI，或跑在 VSCode 的虚拟文件系统上。
 */
export interface S2rEnv {
  readonly exists: (path: string) => boolean;
  /** 用户显式配置的内容根（panorama.contentRoots），优先于自动探测 */
  readonly contentRoots?: readonly string[];
}

export interface S2rCandidate {
  readonly kind: 'explicit' | 'A' | 'B';
  readonly root: string;
  /** true 表示该根本身就是 panorama 内容目录，s2r 路径要剥掉 panorama/ 前缀 */
  readonly stripPanoramaPrefix: boolean;
  readonly distance: number;
}

const S2R = 's2r://';

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '' : p.slice(0, i);
}

/** 把编译产物后缀映射回可能的源文件后缀，按尝试顺序返回 */
export function sourceCandidatesFor(compiledPath: string): string[] {
  const p = normalize(compiledPath);
  if (p.endsWith('.vcss_c')) return [p.replace(/\.vcss_c$/, '.css'), p.replace(/\.vcss_c$/, '.vcss')];
  if (p.endsWith('.vxml_c')) return [p.replace(/\.vxml_c$/, '.xml'), p.replace(/\.vxml_c$/, '.vxml')];
  if (p.endsWith('.vsvg')) return [p.replace(/\.vsvg$/, '.svg')];
  if (p.endsWith('.vtex_c')) return [p.replace(/\.vtex_c$/, '.png')];
  if (p.endsWith('.vtex')) return [p.replace(/\.vtex$/, '.png')];
  return [p];
}

/**
 * 收集全部内容根候选，按距离近→远排序。
 *
 * 不能写成「A 优先，A 失败才用 B」——20260716 形态下祖先目录恰好也叫
 * panorama，候选 A 会「成功地」给出错误答案，B 便永远够不着。名称巧合
 * 只能靠存在性验证排除，不能靠规则优先级。
 */
export function contentRootCandidates(fromFile: string, env: S2rEnv): S2rCandidate[] {
  const file = normalize(fromFile);
  const out: S2rCandidate[] = [];

  for (const root of env.contentRoots ?? []) {
    out.push({ kind: 'explicit', root: normalize(root), stripPanoramaPrefix: false, distance: -1 });
  }

  let dir = dirOf(file);
  let distance = 0;
  while (dir) {
    // 候选 B：该目录同时含 layout/ 与 styles/，它本身就是 panorama 内容目录
    if (env.exists(`${dir}/layout`) && env.exists(`${dir}/styles`)) {
      out.push({ kind: 'B', root: dir, stripPanoramaPrefix: true, distance });
    }
    // 候选 A：文件相对该目录的路径以 panorama/ 开头
    if (file.startsWith(`${dir}/panorama/`)) {
      out.push({ kind: 'A', root: dir, stripPanoramaPrefix: false, distance });
    }
    const parent = dirOf(dir);
    if (parent === dir) break;
    dir = parent;
    distance++;
  }

  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * 把一条 s2r 引用解析成磁盘上真实存在的源文件路径。
 * 全部候选都不存在时返回 undefined —— 这个结果本身有用，M4 据此报
 * 「引用的资源不存在」。
 */
export function resolveS2r(
  fromFile: string,
  s2rPath: string,
  env: S2rEnv,
): string | undefined {
  const raw = s2rPath.startsWith(S2R) ? s2rPath.slice(S2R.length) : s2rPath;
  if (raw === s2rPath && !/^panorama\//.test(raw)) return undefined;

  for (const c of contentRootCandidates(fromFile, env)) {
    const rest = c.stripPanoramaPrefix ? raw.replace(/^panorama\//, '') : raw;
    const compiled = `${c.root}/${rest}`;
    for (const source of sourceCandidatesFor(compiled)) {
      if (env.exists(source)) return source;
    }
  }
  return undefined;
}
