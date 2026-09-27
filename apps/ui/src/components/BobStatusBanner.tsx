/**
 * @node 09.02 — Bob Integration Status Banner
 *
 * Rule 3: Bob disabled = explicit amber notice, never silent degradation.
 *
 * When BOB_INTEGRATION_ENABLED is false (read from /api/bob/status),
 * this banner renders visibly in amber so no developer is surprised by
 * stub behaviour.
 */

import { useQuery } from '@tanstack/react-query';
import { getBobStatus } from '../api/client.js';

export function BobStatusBanner(): JSX.Element | null {
  const { data } = useQuery({
    queryKey: ['bob-status'],
    queryFn: getBobStatus,
    staleTime: 60_000,
  });

  if (!data || data.enabled) return null;

  return (
    <div
      role="alert"
      style={{
        background: '#fef3c7',
        borderBottom: '1px solid #f59e0b',
        color: '#92400e',
        fontSize: 13,
        padding: '6px 16px',
        textAlign: 'center',
      }}
    >
      ⚠ {data.notice}
    </div>
  );
}
