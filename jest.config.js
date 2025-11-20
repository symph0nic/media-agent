export default {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleFileExtensions: ["js", "json"],
  setupFilesAfterEnv: ["<rootDir>/tests/setupEnv.js"],
  collectCoverageFrom: ["src/**/*.js"],
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "src/index.js",
    "src/telegram/bot.js"
  ]
};
