import { useEffect, useState } from 'react';
import { BadgeCheck, Check, Flag, Home, X } from 'lucide-react';
import {
  fetchModerationQueue,
  moderateListing,
  reviewListingReport,
  reviewTumVerification,
  type ModerationQueue,
} from '../lib/marketplace';

type Props = { onClose: () => void; onChanged: () => void };

const emptyQueue: ModerationQueue = { listings: [], reports: [], verifications: [] };

export function ModerationDialog({ onClose, onChanged }: Props) {
  const [queue, setQueue] = useState(emptyQueue);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      setQueue(await fetchModerationQueue());
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load the review queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const runAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try {
      await action();
      await refresh();
      onChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save the moderation decision.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="post-modal moderation-modal" role="dialog" aria-modal="true" aria-labelledby="moderation-title">
        <button className="modal-close" onClick={onClose} aria-label="Close moderation"><X size={19} /></button>
        <span className="section-kicker">COMMUNITY OPERATIONS</span>
        <h2 id="moderation-title">Review queue</h2>
        {notice && <p className="workflow-notice" role="status">{notice}</p>}
        {loading ? <p className="moderation-loading">Loading reports and requests...</p> : <div className="moderation-sections">
          <section className="moderation-section"><h3><Home size={15} /> Pending listings <span>{queue.listings.length}</span></h3>{queue.listings.length ? queue.listings.map((listing) => <article className="moderation-item" key={listing.id}><div><b>{listing.title}</b><small>{listing.category} · {listing.location}</small></div><div className="moderation-actions"><button disabled={busyId === listing.id} onClick={() => void runAction(listing.id, () => moderateListing(listing.id, 'rejected'))}>Reject</button><button className="approve-action" disabled={busyId === listing.id} onClick={() => void runAction(listing.id, () => moderateListing(listing.id, 'active'))}><Check size={13} /> Approve</button></div></article>) : <p className="moderation-empty">Nothing waiting for listing review.</p>}</section>
          <section className="moderation-section"><h3><BadgeCheck size={15} /> Community verification <span>{queue.verifications.length}</span></h3>{queue.verifications.length ? queue.verifications.map((request) => <article className="moderation-item" key={request.id}><div><b>{request.university_email}</b><small>{request.note || 'No additional note'}</small></div><div className="moderation-actions"><button disabled={busyId === request.id} onClick={() => void runAction(request.id, () => reviewTumVerification(request.id, false))}>Decline</button><button className="approve-action" disabled={busyId === request.id} onClick={() => void runAction(request.id, () => reviewTumVerification(request.id, true))}><Check size={13} /> Verify</button></div></article>) : <p className="moderation-empty">Nothing waiting for verification.</p>}</section>
          <section className="moderation-section"><h3><Flag size={15} /> Listing reports <span>{queue.reports.length}</span></h3>{queue.reports.length ? queue.reports.map((report) => <article className="moderation-item moderation-report" key={report.id}><div><b>{report.reason}</b><small>{report.listing_title || 'Listing'}{report.details ? ` · ${report.details}` : ''}</small></div><div className="moderation-actions"><button disabled={busyId === report.id} onClick={() => void runAction(report.id, () => reviewListingReport(report.id, 'dismissed'))}>Dismiss</button><button className="approve-action" disabled={busyId === report.id} onClick={() => void runAction(report.id, () => reviewListingReport(report.id, 'resolved'))}><Check size={13} /> Resolve</button></div></article>) : <p className="moderation-empty">No open reports.</p>}</section>
        </div>}
      </section>
    </div>
  );
}
