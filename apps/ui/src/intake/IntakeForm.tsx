/**
 * @node 09.01 — Intake Form
 *
 * Repository selection, failure report entry, and investigation authorization.
 * Validates with zod and posts to POST /api/incidents.
 *
 * Rule 23: investigation must be explicitly authorized by the human developer
 * before any automated work begins.
 */

import { useState } from 'react';
import { z } from 'zod';
import { createIncident } from '../api/client.js';

const IntakeSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  repositoryPath: z.string().min(1, 'Repository path is required'),
  failureDescription: z.string().min(10, 'Please describe the failure in at least 10 characters'),
  authorized: z.literal(true, {
    errorMap: () => ({ message: 'You must authorize the investigation before submitting' }),
  }),
});

type IntakeForm = z.infer<typeof IntakeSchema>;

interface Props {
  onCreated: (incidentId: string) => void;
}

export function IntakeForm({ onCreated }: Props): JSX.Element {
  const [form, setForm] = useState<Partial<IntakeForm>>({});
  const [errors, setErrors] = useState<Partial<Record<keyof IntakeForm, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const parsed = IntakeSchema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof IntakeForm;
        fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    setServerError(null);
    try {
      const result = await createIncident({
        title: parsed.data.title,
        repositoryPath: parsed.data.repositoryPath,
        failureReport: { description: parsed.data.failureDescription },
      });
      onCreated(result.incidentId);
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  const field = (name: keyof IntakeForm) => ({
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [name]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    },
  });

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <h2 style={{ marginBottom: 16 }}>New Incident</h2>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Title</span>
        <input
          type="text"
          placeholder="Brief description of the failure"
          style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4 }}
          {...field('title')}
        />
        {errors.title && <span style={{ color: '#dc2626', fontSize: 12 }}>{errors.title}</span>}
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Repository Path</span>
        <input
          type="text"
          placeholder="/path/to/repository or git URL"
          style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4 }}
          {...field('repositoryPath')}
        />
        {errors.repositoryPath && <span style={{ color: '#dc2626', fontSize: 12 }}>{errors.repositoryPath}</span>}
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Failure Description</span>
        <textarea
          rows={4}
          placeholder="What happened? Include symptoms, timing, affected users, relevant logs."
          style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 4, resize: 'vertical' }}
          {...field('failureDescription')}
        />
        {errors.failureDescription && <span style={{ color: '#dc2626', fontSize: 12 }}>{errors.failureDescription}</span>}
      </label>

      {/* Rule 23: explicit authorization required before investigation begins */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, fontSize: 13 }}>
        <input
          type="checkbox"
          style={{ marginTop: 2 }}
          onChange={(e) => setForm((prev) => ({ ...prev, authorized: e.target.checked || undefined }))}
        />
        <span>
          I authorize the Software Immune System to investigate this repository, collect evidence,
          and propose a repair candidate. I understand that no change will be deployed without my
          explicit approval.
        </span>
      </label>
      {errors.authorized && <span style={{ color: '#dc2626', fontSize: 12, display: 'block', marginBottom: 12 }}>{errors.authorized}</span>}

      {serverError && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, padding: 8, marginBottom: 12, color: '#991b1b', fontSize: 13 }}>
          {serverError}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{ background: '#3b82d4', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 20px', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}
      >
        {submitting ? 'Submitting…' : 'Begin Investigation'}
      </button>
    </form>
  );
}
