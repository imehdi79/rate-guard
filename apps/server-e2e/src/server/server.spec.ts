import axios from 'axios';

describe('GET /api', () => {
  it('rejects requests without an api key', async () => {
    const res = await axios.get(`/api`, { validateStatus: () => true });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/health', () => {
  it('is public and reports liveness', async () => {
    const res = await axios.get(`/api/health`);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: 'Alive' });
  });
});
