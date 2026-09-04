import type { VxmlDocument } from '../vxml/ast';
import type { VcssDocument } from '../vcss/ast';
import { symbolsOfVxml, symbolsOfVcss, type SymbolRef, type ResourceRef } from '../index/symbols';
import type { SymbolLocation, WorkspaceIndex } from '../index/workspace-index';
import { resolveS2r, type S2rEnv } from '../index/s2r';

/** 命中某个偏移的符号 */
function hit<T extends { start: number; end: number }>(
  refs: readonly T[],
  offset: number,
): T | undefined {
  return refs.find((r) => offset >= r.start && offset <= r.end);
}

/** 资源引用跳转的目标：整个文件，区间取 0 */
function fileTarget(uri: string): SymbolLocation {
  return { uri, name: uri, start: 0, end: 0 };
}

function resourceDefinition(
  fromUri: string,
  refs: readonly ResourceRef[],
  offset: number,
  env: S2rEnv,
): SymbolLocation[] {
  const r = hit(refs, offset);
  if (!r) return [];
  const target = resolveS2r(fromUri, r.target, env);
  return target ? [fileTarget(target)] : [];
}

export function vxmlDefinitionsAt(
  uri: string,
  doc: VxmlDocument,
  offset: number,
  index: WorkspaceIndex,
  env: S2rEnv,
): SymbolLocation[] {
  const s = symbolsOfVxml(uri, doc);

  const cls = hit(s.classRefs, offset);
  if (cls) return [...index.classDefinitions(cls.name)];

  const res = resourceDefinition(uri, [...s.includes, ...s.resources], offset, env);
  if (res.length) return res;

  return [];
}

export function vxmlReferencesAt(
  uri: string,
  doc: VxmlDocument,
  offset: number,
  index: WorkspaceIndex,
): SymbolLocation[] {
  const s = symbolsOfVxml(uri, doc);

  const cls = hit(s.classRefs, offset);
  if (cls) return [...index.classDefinitions(cls.name), ...index.classReferences(cls.name)];

  const id = hit(s.idDefs, offset);
  if (id) return [...index.idDefinitions(id.name), ...index.idReferences(id.name)];

  return [];
}

export function vcssDefinitionsAt(
  uri: string,
  doc: VcssDocument,
  offset: number,
  index: WorkspaceIndex,
  env: S2rEnv,
): SymbolLocation[] {
  const s = symbolsOfVcss(uri, doc);

  // defineRefs 是「候选」：抽取层收集声明值里的全部裸标识符，因为它没有
  // 跨文件视野，判断不了某个标识符是不是常量引用。真正的判定在这里——
  // 索引里查得到定义才算数，否则 flow-children: right 的 right 也会被当成引用。
  const ref = hit(s.defineRefs, offset);
  if (ref && index.defineDefinitions(ref.name).length > 0) {
    return [...index.defineDefinitions(ref.name)];
  }

  const kf = hit(s.keyframeRefs, offset);
  if (kf) return [...index.keyframeDefinitions(kf.name)];

  const id = hit(s.idRefs, offset);
  if (id) return [...index.idDefinitions(id.name)];

  const res = resourceDefinition(uri, s.includes, offset, env);
  if (res.length) return res;

  return [];
}

export function vcssReferencesAt(
  uri: string,
  doc: VcssDocument,
  offset: number,
  index: WorkspaceIndex,
): SymbolLocation[] {
  const s = symbolsOfVcss(uri, doc);

  const clsDef: SymbolRef | undefined = hit(s.classDefs, offset);
  if (clsDef) {
    return [...index.classDefinitions(clsDef.name), ...index.classReferences(clsDef.name)];
  }

  // 同上：defineRefs 是候选，索引里查得到定义才当成常量
  const def = hit(s.defineDefs, offset) ?? hit(s.defineRefs, offset);
  if (def && index.defineDefinitions(def.name).length > 0) {
    return [...index.defineDefinitions(def.name), ...index.defineReferences(def.name)];
  }

  const kf = hit(s.keyframeDefs, offset) ?? hit(s.keyframeRefs, offset);
  if (kf) return [...index.keyframeDefinitions(kf.name), ...index.keyframeReferences(kf.name)];

  return [];
}
