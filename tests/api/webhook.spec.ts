import { test, expect } from '@playwright/test';

const WEBHOOK_PATH = '/webhook/support-ticket';
const AUTH_TOKEN = process.env.WEBHOOK_SECRET_TOKEN || 'secure_triage_webhook_bearer_token_xyz123';

test.describe('Security & Triage Webhook Pipeline', () => {

  test('Security: should reject requests missing authorization token (401)', async ({ request }) => {
    const response = await request.post(WEBHOOK_PATH, {
      data: {
        idempotency_key: 'test-unauth-1',
        customer_email: 'test@example.com',
        subject: 'Password issue',
        content: 'Cannot login',
      },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toContain('Unauthorized');
  });

  test('Security: should reject requests with invalid authorization token (401)', async ({ request }) => {
    const response = await request.post(WEBHOOK_PATH, {
      headers: {
        'x-webhook-token': 'invalid_secret_attack',
      },
      data: {
        idempotency_key: 'test-invalid-auth-1',
        customer_email: 'test@example.com',
        subject: 'Password issue',
        content: 'Cannot login',
      },
    });

    expect(response.status()).toBe(401);
  });

  test('Validation: should reject payload missing required fields (400)', async ({ request }) => {
    const response = await request.post(WEBHOOK_PATH, {
      headers: {
        'x-webhook-token': AUTH_TOKEN,
      },
      data: {
        // missing idempotency_key, subject, content
        customer_email: 'test@example.com',
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Bad Request');
  });

  test('Functional: should process tier 1 password reset request autonomously (201)', async ({ request }) => {
    const uniqueKey = `idemp-pwd-${Date.now()}`;
    const response = await request.post(WEBHOOK_PATH, {
      headers: {
        'x-webhook-token': AUTH_TOKEN,
      },
      data: {
        idempotency_key: uniqueKey,
        customer_id: 'cust-101',
        customer_email: 'engineer@corp.com',
        subject: 'Need help resetting my corporate password',
        content: 'I got locked out of my corporate login credentials after 3 attempts.',
      },
    });

    expect([200, 201]).toContain(response.status());
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.ticket.category).toBe('auth');
    expect(body.ticket.assigned_tier).toBe('tier_1_bot');
    expect(body.ticket.automated_response).toBeTruthy();
  });

  test('Resilience: should handle duplicate idempotency_key gracefully without reprocessing (Idempotent 200)', async ({ request }) => {
    const duplicateKey = `idemp-dup-${Date.now()}`;
    const payload = {
      idempotency_key: duplicateKey,
      customer_id: 'cust-202',
      customer_email: 'billing@client.com',
      subject: 'Discrepancy in monthly billing invoice',
      content: 'We noticed an unexpected charge on our enterprise invoice for this month.',
    };

    // First call: creates ticket
    const res1 = await request.post(WEBHOOK_PATH, {
      headers: { 'x-webhook-token': AUTH_TOKEN },
      data: payload,
    });
    expect([200, 201]).toContain(res1.status());

    // Second call with same idempotency key: must be detected as duplicate
    const res2 = await request.post(WEBHOOK_PATH, {
      headers: { 'x-webhook-token': AUTH_TOKEN },
      data: payload,
    });
    expect(res2.status()).toBe(200);
    const body2 = await res2.json();
    expect(body2.status).toBe('idempotent_duplicate');
  });

  test('Escalation: should classify critical outage and route to security escalation (201)', async ({ request }) => {
    const criticalKey = `idemp-crit-${Date.now()}`;
    const response = await request.post(WEBHOOK_PATH, {
      headers: {
        'x-webhook-token': AUTH_TOKEN,
      },
      data: {
        idempotency_key: criticalKey,
        customer_id: 'cust-sec-999',
        customer_email: 'cto@partner.io',
        subject: 'URGENT: Database service outage and suspected exploit breach',
        content: 'We detected suspicious exfiltration attempts and our production cluster is down.',
      },
    });

    expect([200, 201]).toContain(response.status());
    const body = await response.json();
    expect(body.ticket.category).toBe('incident');
    expect(body.ticket.urgency).toBe('critical');
    expect(body.ticket.assigned_tier).toBe('security_escalation');
  });

  test('Security: should safely handle potential SQL injection in idempotency_key and content', async ({ request }) => {
    const maliciousKey = `sqli-probe-' OR '1'='1--${Date.now()}`;
    const response = await request.post(WEBHOOK_PATH, {
      headers: {
        'x-webhook-token': AUTH_TOKEN,
      },
      data: {
        idempotency_key: maliciousKey,
        customer_id: "test-user-sqli'; --",
        customer_email: 'security-audit@example.com',
        subject: "Subject with quotes ' and -- comments",
        content: "Content with special characters ' ' -- /* */",
      },
    });

    expect([200, 201]).toContain(response.status());
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.ticket.idempotency_key).toBe(maliciousKey);
  });

});
