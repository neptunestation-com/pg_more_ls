-- Phase 0.3: create a placeholder pgmq queue so the worker has
-- something to poll during early-phase development.
--
-- Real per-job queues (q_verify, q_drift_check, q_binder,
-- q_simulate_scan, per phasing plan §6.7) come in their respective
-- feature phases. This one exists only so the worker can demonstrate
-- end-to-end pgmq poll/archive behavior with no real work attached.

select pgmq.create('q_placeholder');
