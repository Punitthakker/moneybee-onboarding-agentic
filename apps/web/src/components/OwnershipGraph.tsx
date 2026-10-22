import { useMemo } from 'react';
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import type { UboResult } from '../types';

export function OwnershipGraph({ ubo }: { ubo: UboResult }) {
  const { nodes, edges } = useMemo(() => {
    const byLayer = new Map<number, UboResult['nodes']>();
    ubo.nodes.forEach((n) => byLayer.set(n.layer, [...(byLayer.get(n.layer) ?? []), n]));
    const maxLayer = Math.max(...ubo.nodes.map((n) => n.layer));
    const nodes: Node[] = ubo.nodes.map((n) => {
      const row = byLayer.get(n.layer)!;
      const i = row.indexOf(n);
      const style: React.CSSProperties = {
        borderRadius: n.kind === 'person' ? 999 : 18, padding: '10px 14px', fontFamily: 'var(--sans)', fontSize: 13, width: 200, textAlign: 'center',
        border: '1px solid var(--chip-line)', background: '#fff', color: 'var(--ink)',
      };
      if (n.kind === 'company') Object.assign(style, { background: 'var(--footer)', color: 'var(--cream)', border: 'none', fontWeight: 600 });
      if (n.kind === 'entity') Object.assign(style, { background: 'var(--cream)' });
      if (n.isUbo) Object.assign(style, { background: 'var(--honey)', border: 'none', fontWeight: 600, boxShadow: '0 0 0 6px rgba(222,186,110,.3)' });
      return {
        id: n.id,
        position: { x: (i - (row.length - 1) / 2) * 240, y: (maxLayer - n.layer) * 140 },
        data: { label: <div>{n.label}{n.effectivePct !== undefined && <div className="mono" style={{ fontSize: 11.5, opacity: 0.8, marginTop: 2 }}>{n.effectivePct.toFixed(2)}% effective{n.isUbo ? ' · UBO' : ''}</div>}{n.kind === 'entity' && <div style={{ fontSize: 11, opacity: 0.7 }}>corporate shareholder</div>}</div> },
        style,
        draggable: true,
      };
    });
    const edges: Edge[] = ubo.edges.map((e, i) => ({
      id: `e${i}`, source: e.from, target: e.to, label: `${e.pct}%`, animated: false,
      style: { stroke: '#915f17', strokeWidth: 1.5 }, labelStyle: { fontFamily: 'var(--mono)', fontSize: 12, fill: '#17140f' }, labelBgStyle: { fill: '#fbf8f1' }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 8,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#915f17' },
    }));
    return { nodes, edges };
  }, [ubo]);
  return (
    <div className="graphbox" aria-label="Ownership graph">
      <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.25 }} proOptions={{ hideAttribution: true }} nodesConnectable={false}>
        <Background color="#e5dccb" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
