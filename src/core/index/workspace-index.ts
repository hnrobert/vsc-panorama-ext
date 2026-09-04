import type { FileSymbols, SymbolRef } from './symbols';
import { resolveS2r, type S2rEnv } from './s2r';

export interface SymbolLocation {
  readonly uri: string;
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

type Bucket = Map<string, SymbolLocation[]>;

const EMPTY: readonly SymbolLocation[] = Object.freeze([]);

function addAll(bucket: Bucket, uri: string, refs: readonly SymbolRef[]): void {
  for (const r of refs) {
    const list = bucket.get(r.name) ?? [];
    list.push({ uri, name: r.name, start: r.start, end: r.end });
    bucket.set(r.name, list);
  }
}

function dropFile(bucket: Bucket, uri: string): void {
  for (const [name, list] of bucket) {
    const kept = list.filter((l) => l.uri !== uri);
    if (kept.length === 0) bucket.delete(name);
    else bucket.set(name, kept);
  }
}

/**
 * 工作区符号索引。主表按 uri 存 FileSymbols，另建若干反向索引供 O(1) 查名。
 * 增量更新的正确性靠一条不变式：update/remove 必须先把该 uri 的旧条目从
 * 所有反向索引里摘干净，再写新的——否则改一次文件就多一份僵尸符号。
 */
export class WorkspaceIndex {
  private readonly files = new Map<string, FileSymbols>();
  private readonly classDefs: Bucket = new Map();
  private readonly classRefs: Bucket = new Map();
  private readonly idDefs: Bucket = new Map();
  private readonly idRefs: Bucket = new Map();
  private readonly defineDefs: Bucket = new Map();
  private readonly defineRefs: Bucket = new Map();
  private readonly keyframeDefs: Bucket = new Map();
  private readonly keyframeRefs: Bucket = new Map();
  private readonly env: S2rEnv;
  private readonly listeners = new Set<() => void>();

  constructor(env: S2rEnv) {
    this.env = env;
  }

  /**
   * 索引内容发生任何变化时回调。诊断的跨文件规则（vcss.unknownDefine /
   * vcss.unknownKeyframes / vxml.unknownClass）的结论完全取决于索引内容：
   * 别的文件里刚定义了那个 @define，本文件那条「引用不到定义」的诊断就该
   * 消失。没有这个通知，适配层只能在「打开/编辑本文件」时重算，于是索引更新
   * 之后编辑器里会一直挂着过期的「未定义」，直到用户随手改一下这个文件。
   *
   * 放在这里而不是索引宿主（src/vscode/index-host.ts）里，是因为宿主有三处
   * 各自独立的写入点（全量扫描的 ingest、watcher 的 drop、编辑防抖后的
   * update），逐处补通知漏掉任何一处的后果都是「诊断静默过期」——恰恰是本
   * 任务要防的失效模式。挂在唯一的写入口上，漏不掉。
   *
   * 返回的对象形状与 vscode.Disposable 一致（只有一个 dispose 方法），但这里
   * 不 import vscode：core 层的硬约束。
   */
  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }

  update(symbols: FileSymbols): void {
    this.detach(symbols.uri);
    this.files.set(symbols.uri, symbols);
    const u = symbols.uri;
    addAll(this.classDefs, u, symbols.classDefs);
    addAll(this.classRefs, u, symbols.classRefs);
    addAll(this.idDefs, u, symbols.idDefs);
    addAll(this.idRefs, u, symbols.idRefs);
    addAll(this.defineDefs, u, symbols.defineDefs);
    addAll(this.defineRefs, u, symbols.defineRefs);
    addAll(this.keyframeDefs, u, symbols.keyframeDefs);
    addAll(this.keyframeRefs, u, symbols.keyframeRefs);
    this.notify();
  }

  remove(uri: string): void {
    if (!this.detach(uri)) return;
    this.notify();
  }

  /**
   * 把某个 uri 的条目从主表与所有反向索引里摘干净，返回它原本是否存在。
   * update 与 remove 共用它，好处不只是去重：update 内部若直接调 remove()，
   * 一次 update 会发两次通知（remove 一次、update 一次），订阅方得自己去重。
   */
  private detach(uri: string): boolean {
    if (!this.files.delete(uri)) return false;
    for (const b of [
      this.classDefs,
      this.classRefs,
      this.idDefs,
      this.idRefs,
      this.defineDefs,
      this.defineRefs,
      this.keyframeDefs,
      this.keyframeRefs,
    ]) {
      dropFile(b, uri);
    }
    return true;
  }

  get(uri: string): FileSymbols | undefined {
    return this.files.get(uri);
  }

  allFiles(): readonly string[] {
    return [...this.files.keys()];
  }

  classDefinitions(name: string): readonly SymbolLocation[] {
    const list = this.classDefs.get(name);
    return list ? [...list] : EMPTY;
  }
  classReferences(name: string): readonly SymbolLocation[] {
    const list = this.classRefs.get(name);
    return list ? [...list] : EMPTY;
  }
  idDefinitions(name: string): readonly SymbolLocation[] {
    const list = this.idDefs.get(name);
    return list ? [...list] : EMPTY;
  }
  idReferences(name: string): readonly SymbolLocation[] {
    const list = this.idRefs.get(name);
    return list ? [...list] : EMPTY;
  }
  defineDefinitions(name: string): readonly SymbolLocation[] {
    const list = this.defineDefs.get(name);
    return list ? [...list] : EMPTY;
  }
  defineReferences(name: string): readonly SymbolLocation[] {
    const list = this.defineRefs.get(name);
    return list ? [...list] : EMPTY;
  }
  keyframeDefinitions(name: string): readonly SymbolLocation[] {
    const list = this.keyframeDefs.get(name);
    return list ? [...list] : EMPTY;
  }
  keyframeReferences(name: string): readonly SymbolLocation[] {
    const list = this.keyframeRefs.get(name);
    return list ? [...list] : EMPTY;
  }

  allClassNames(): readonly string[] {
    return [...this.classDefs.keys()];
  }
  allIdNames(): readonly string[] {
    return [...this.idDefs.keys()];
  }
  allDefineNames(): readonly string[] {
    return [...this.defineDefs.keys()];
  }
  allKeyframeNames(): readonly string[] {
    return [...this.keyframeDefs.keys()];
  }

  /** 该文件通过 <include> 或 @import 直接引入的样式表（已解析成实际路径） */
  includedStylesheets(uri: string): readonly string[] {
    const s = this.files.get(uri);
    if (!s) return [];
    const out: string[] = [];
    for (const inc of s.includes) {
      const target = resolveS2r(uri, inc.target, this.env);
      if (target) out.push(target);
    }
    return out;
  }
}
