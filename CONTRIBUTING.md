# Contributing

Thanks for your interest in contributing to three-instance-batch.

## Getting Started

```bash
git clone https://github.com/qiao-coding/three-instance-batch.git
cd three-instance-batch
npm install
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the demo at `localhost:5173` |
| `npm run build` | Build the library to `dist/` |
| `npm run test:run` | Run all tests (56 currently) |
| `npm run test` | Start vitest in watch mode |

## Workflow

1. Fork the repo and create a branch from `master`.
2. Make your changes. Add tests if applicable.
3. Run `npm run test:run` to ensure nothing is broken.
4. Run `npm run build` to verify the build succeeds.
5. Open a pull request.

## Guidelines

- Keep the library focused on batching and dirty tracking. Features like model loading, texture atlases, or shader effects belong in userland.
- Follow the existing code style: 2-space indentation, semicolons, camelCase.
- Types live in `src/types.ts`. Implementation files should not define exported types.
- PRs that change the public API should update both `README.md` and `README_zh.md`.

## Issues

Bug reports and feature requests are welcome. Please include a minimal reproduction case when reporting a bug.
