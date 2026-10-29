-- Sample knowledge base entries for automated triage
SET search_path TO app_triage, public;

INSERT INTO app_triage.knowledge_base (title, slug, category, content, metadata, embedding)
VALUES
(
    'How to Reset Account Password',
    'password-reset-guide',
    'auth',
    'Users can reset their password by visiting https://app.example.com/forgot-password and entering their registered corporate email. An OTP reset link will be sent with a 15-minute expiration.',
    '{"author": "Security Team", "target_audience": "all"}'::jsonb,
    app_triage.generate_test_embedding(1)
),
(
    'Billing and Invoicing FAQ',
    'billing-and-invoicing',
    'billing',
    'Invoices are generated on the 1st of each calendar month. We support Visa, Mastercard, AMEX, and SEPA transfers. Wire transfers require an Enterprise tier subscription.',
    '{"author": "Finance Team", "target_audience": "customers"}'::jsonb,
    app_triage.generate_test_embedding(2)
),
(
    'Service Level Agreement (SLA) & Incident Escalation',
    'sla-incident-escalation',
    'incident',
    'P1 Critical Outages: Initial response within 15 minutes. High severity: within 1 hour. Any security breach or data exfiltration report must be routed immediately to security_escalation tier with human paging.',
    '{"author": "Ops Team", "target_audience": "internal"}'::jsonb,
    app_triage.generate_test_embedding(3)
)
ON CONFLICT (slug) DO NOTHING;
