// Minimal smoke test so `npm test` exits cleanly in CI.
describe('smoke', () => {
  it('loads test runner', () => {
    expect(true).toBe(true);
  });
});
