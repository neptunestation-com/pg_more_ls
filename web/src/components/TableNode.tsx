import { Handle, Position, type NodeProps } from '@xyflow/react'

export interface TableNodeData {
  tableName: string
  schemaName: string
  hasRls: boolean
  rlsForced: boolean
  governanceStatus: 'red' | 'yellow' | 'green' | 'gray'
  columnCount: number
  columns: Array<{ name: string; dataType: string }>
  [key: string]: unknown
}

export function TableNode({ data, selected }: NodeProps) {
  const d = data as unknown as TableNodeData
  return (
    <div
      className={`table-node status-${d.governanceStatus} ${selected ? 'selected' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="table-node-header">
        <strong title={`${d.schemaName}.${d.tableName}`}>{d.tableName}</strong>
        <span className={`status-pill ${d.governanceStatus}`}>
          {d.hasRls ? (d.rlsForced ? 'rls forced' : 'rls') : 'no rls'}
        </span>
      </div>
      <div className="table-node-body">
        {d.columns.slice(0, 5).map((c) => (
          <div key={c.name} className="col-row">
            <span className="col-name">{c.name}</span>
            <span className="col-type">{c.dataType}</span>
          </div>
        ))}
        {d.columns.length > 5 && (
          <div className="col-row col-more">
            …{d.columns.length - 5} more
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
