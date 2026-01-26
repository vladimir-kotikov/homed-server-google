describe("example test", () => {
  it("should pass", () => {
    expect(1 + 1).toBe(2);
  });

  it("should handle arrays", () => {
    const arr = [1, 2, 3];
    expect(arr).toHaveLength(3);
    expect(arr).toContain(2);
  });
});
