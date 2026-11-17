export default {
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Keep the 12,000-case arithmetic test within its timeout on shared machines.
    maxWorkers: 2,
  },
};
