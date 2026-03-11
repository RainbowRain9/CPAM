# Workspace Instructions - CLI Proxy API Management Center

> Last updated: 2026-03-12  
> Project Type: Full-Stack (React + Express)

## 🎯 Quick Project Overview

**CLI Proxy API Management Center** is a full-stack web application for managing and monitoring the [CLI-Proxy-API](https://github.com/router-for-me/CLIProxyAPI) multi-model proxy tool.

- **Frontend**: React 19 + TypeScript 5.9, Vite build system
- **Backend**: Node.js 20 + Express.js 4.18, better-sqlite3
- **Deployment**: Docker container or systemd service on port 7940
- **Key Feature**: Persistent usage statistics, provider management, pricing analysis

---

## 📦 Project Structure

```
.
├── Cli-Proxy-API-Management-Center/     # Frontend React app
│   ├── src/
│   │   ├── pages/                       # Page components (Dashboard, Config, OAuth, etc.)
│   │   ├── components/                  # Organized by domain (providers, quota, usage, config)
│   │   ├── hooks/                       # Custom hooks (useApi, useDebounce, usePagination)
│   │   ├── stores/                      # Zustand state management
│   │   ├── services/                    # API clients, utilities
│   │   ├── i18n/                        # Translations (en, zh-CN, ru)
│   │   └── App.tsx                      # Root + HashRouter config
│   └── vite.config.ts                   # Single-file output + version injection
├── server/
│   ├── server.js                        # Express app, API routes, SSE, proxy
│   └── db.js                            # SQLite schema + initialization
├── data/
│   ├── usage.db                         # Runtime SQLite (auto-created)
│   └── settings.json                    # User settings (URLs, limits)
├── scripts/
│   ├── install-systemd.sh               # systemd service installer
│   └── start-local.sh                   # Production launcher
├── deploy/
│   └── systemd/api-center.service       # systemd unit file
├── docker-compose.yml                   # Container orchestration
├── package.json                         # Monorepo root scripts
└── README.md                            # (English in /README.md)
```

---

## 🚀 Essential Commands

### Development
```bash
npm install                    # Install dependencies (runs once)
npm run dev                    # Start both frontend (5173) + backend (7940) concurrently
npm run build                  # Build React to dist/index.html (single file)
npm start                      # Run production server on port 7940
docker-compose up --build      # Containerize entire app
```

### Frontend-specific (in `Cli-Proxy-API-Management-Center/`)
```bash
npm run lint                   # ESLint + TypeScript checks
npm run format                 # Prettier auto-format
npm run type-check             # tsc --noEmit validation
npm run preview                # Serve dist locally
```

### systemd (Linux)
```bash
./scripts/install-systemd.sh   # Install auto-start service
systemctl status api-center    # Check service status
systemctl restart api-center   # Restart service
journalctl -u api-center -f    # Stream logs
```

---

## 📋 Architecture Decisions & Key Patterns

### Single-File Build Pattern
- **Decision**: Frontend builds to a single `dist/index.html` with all assets inlined (via `vite-plugin-singlefile`)
- **Why**: Deployment trivial (one file per version), works with any static server, ideal for internal tools
- **Trade-off**: No code-splitting; bundle ~2-3 MB (acceptable for admin UI)
- **Impact**: When updating frontend, only `dist/index.html` changes on disk

### State Management: Zustand + localStorage
- **Stores**: Each feature has a `use[Feature]Store.ts` file (e.g., `useAuthStore.ts`, `useConfigStore.ts`)
- **Persistence**: Stores with `persist` middleware auto-sync to localStorage
- **Pattern**: Stores hold centralized state; components read via hooks; server changes trigger refetch

### API Client: Centralized useApi Hook
- **File**: `src/hooks/useApi.ts`
- **Pattern**: Returns `{ data, loading, error, mutate }` tuple
- **Interceptors**: Auto-adds auth headers (`x-management-key`), handles 401 redirects
- **Base URL**: `/api/` (proxied to backend in dev, direct in prod)

### Real-Time Updates: Server-Sent Events (SSE)
- **Endpoint**: `GET /api/usage-stream`
- **Format**: Event stream for real-time usage chart updates
- **Client**: Established in `useInterval` hook, cleaned up on component unmount
- **Data Flow**: SQLite → Express → SSE stream → Chart.js frontend

### Routing: HashRouter (File-Friendly)
- **Why**: Works with `file://` protocol and static file serving
- **Routes**: `#/dashboard`, `#/config`, `#/usage`, `#/providers`, etc.
- **Deep-linking**: Preserved across browser reload and deployment

### Responsive Design: Tailwind + CSS Modules
- **Utility**: Tailwind CSS for responsive layout (sm:, md:, lg: breakpoints)
- **Scoped Styles**: SCSS Modules for component-specific styling (`Page.module.scss`)
- **Convention**: SCSS class names in camelCase

### i18n: i18next with 3 Languages
- **Languages**: en, zh-CN (Simplified Chinese), ru (Russian)
- **Files**: `src/i18n/locales/{en,zh-CN,ru}.json`
- **Auto-detection**: Reads browser language; manual switch in footer
- **Convention**: All user-facing text must have translation keys

---

## 🔧 Development Conventions

### Naming Conventions
| Type | Pattern | Example |
|------|---------|---------|
| **Pages** | `[Domain][Entity]Page.tsx` | `AiProvidersPage.tsx`, `ConfigPage.tsx` |
| **Components** | Domain-grouped subdirectories | `components/providers/ProviderCard.tsx` |
| **Hooks** | `use[Feature].ts` | `useApi.ts`, `usePagination.ts` |
| **Stores** | `use[Feature]Store.ts` | `useAuthStore.ts`, `useConfigStore.ts` |
| **Styles** | `[Component].module.scss` | `Page.module.scss`, `Card.module.scss` |
| **API routes** | RESTful `/api/[resource]` | `/api/providers`, `/api/usage/export` |

### Code Style
- **Language**: TypeScript strict mode (`tsconfig.json` enforces `strict: true`)
- **Linting**: ESLint + Prettier (run `npm run format` before commit)
- **React**: Functional components + hooks (no class components)
- **Error handling**: Try-catch in async functions; display toast notifications for user-facing errors
- **Async patterns**: `async/await` preferred over `.then()` chains

### Component Structure Example
```tsx
// src/pages/ExamplePage.tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useExampleStore } from '@/stores/useExampleStore';
import ExampleCard from '@/components/example/ExampleCard';
import styles from './ExamplePage.module.scss';

export default function ExamplePage() {
  const { t } = useTranslation();
  const { items, fetchItems, loading } = useExampleStore();

  useEffect(() => {
    fetchItems();
  }, []);

  return (
    <div className={styles.container}>
      <h1>{t('example.title')}</h1>
      {loading ? <Spinner /> : items.map(item => <ExampleCard key={item.id} item={item} />)}
    </div>
  );
}
```

### Server-Side (Express) Conventions
- **Route handlers**: RESTful semantics (GET, POST, PUT, DELETE)
- **Response format**: `{ code, data, message }` (when error, `data: null`)
- **Status codes**: 200 OK, 400 Bad Request, 401 Unauthorized, 500 Server Error
- **CORS**: Enabled in `server.js`; no hardcoded origins

---

## 🐛 Common Pitfalls & Solutions

| Issue | Root Cause | Solution |
|-------|-----------|----------|
| **CORS Error** | Frontend/backend domain mismatch | Dev proxy in `vite.config.ts` handles `/api` → port 7940 |
| **401 Unauthorized** | Missing/expired management key | Clear localStorage; re-login with correct key from server |
| **Empty usage charts** | No data synced from CLI-Proxy | Enable "Usage Statistics" in Settings; verify CLI-Proxy URL |
| **SQLite database locked** | Multi-process write conflict | WAL mode enabled by default; avoid concurrent writes |
| **Large bundle size** | Single-file build includes everything | Expected ~2-3 MB; acceptable for internal admin UI |
| **Missing translations** | New strings not added to all 3 locales | Always update `src/i18n/locales/{en,zh-CN,ru}.json` together |
| **Type errors after build** | TypeScript in dev ≠ strict build | Run `npm run type-check` before deploying |
| **SSE stream not updating** | Browser tab close doesn't cleanup stream | `useInterval` hook has cleanup logic; check browser console |
| **Git conflicts in i18n** | Multiple contributors updating translations | Merge JSON objects carefully; validate syntax |

---

## 🔌 How to Extend the Project

### Add a New Page
1. Create `src/pages/NewFeaturePage.tsx`
   - Follow `AiProvidersPage.tsx` structure
   - Use hooks for data fetching, Zustand for state
   - Add i18n keys for all text

2. Add route to `src/App.tsx`:
   ```tsx
   <Route path="/new-feature" element={<NewFeaturePage />} />
   ```

3. Add navigation link to sidebar:
   - Edit `src/components/layout/MainLayout.tsx`
   - Add menu item with i18n label

### Add a New API Endpoint
1. Create route in `server/server.js`:
   ```js
   app.get('/api/new-endpoint', (req, res) => {
     // auth check
     // db query or logic
     res.json({ code: 0, data: result });
   });
   ```

2. Create API client in `src/services/`:
   ```ts
   export const fetchNewEndpoint = () => axios.get('/api/new-endpoint');
   ```

3. Use in component via `useApi` hook:
   ```ts
   const { data, loading } = useApi(fetchNewEndpoint);
   ```

### Add a New Feature Store
1. Create `src/stores/useNewFeatureStore.ts`:
   ```ts
   import create from 'zustand';
   import { persist } from 'zustand/middleware';

   export const useNewFeatureStore = create(
     persist(
       (set) => ({
         items: [],
         setItems: (items) => set({ items }),
       }),
       { name: 'new-feature-storage' }
     )
   );
   ```

2. Use in components:
   ```ts
   const { items, setItems } = useNewFeatureStore();
   ```

### Add Translations for New Text
1. Add keys to all 3 locale files:
   ```json
   // src/i18n/locales/en.json
   { "feature.label": "New Feature" }

   // src/i18n/locales/zh-CN.json
   { "feature.label": "新功能" }

   // src/i18n/locales/ru.json
   { "feature.label": "Новая функция" }
   ```

2. Use in component:
   ```tsx
   const { t } = useTranslation();
   <h1>{t('feature.label')}</h1>
   ```

---

## 📱 Deployment Guide

### Docker (Recommended for Production)
```bash
docker-compose up --build      # Build and run container
# Accessible at http://localhost:7940
```

### systemd Service (Linux)
```bash
./scripts/install-systemd.sh   # One-time installation
systemctl start api-center     # Start service
systemctl enable api-center    # Enable auto-start on boot
```

### Manual (Bare Metal)
```bash
npm run build                  # Build frontend
npm start                      # Start server on port 7940
# Keep running in background (use nohup or tmux)
```

---

## 🔍 Debugging Tips

### Frontend Issues
- **DevTools**: Open browser DevTools (F12)
  - **Console**: Check for errors, use `console.log()` while developing
  - **Network**: Verify `/api/*` requests reach backend
  - **Application → Storage → localStorage**: Check auth state, settings
  - **Application → Storage → Cookies**: Verify no stale sessions

### Backend Issues
- **Logs**: Check terminal output where `npm run dev` or `npm start` runs
- **Database**: Check `data/usage.db` exists and has correct schema
  ```bash
  sqlite3 data/usage.db ".schema"
  ```
- **Port conflicts**: Verify port 7940 is free
  ```bash
  lsof -i :7940
  ```

### Full-Stack Issues
1. Run `npm run dev` and watch both terminal outputs
2. Frontend errors appear in browser DevTools
3. Backend errors appear in terminal
4. Network requests visible in browser Network tab
5. Use `console.log()` liberally during debugging

---

## 📚 Key Files Reference

| File | Purpose | Type |
|------|---------|------|
| `Cli-Proxy-API-Management-Center/src/App.tsx` | Root router + layout wrapper | Frontend |
| `Cli-Proxy-API-Management-Center/vite.config.ts` | Build config (single-file plugin) | Config |
| `server/server.js` | Express routes, SSE, proxy | Backend |
| `server/db.js` | SQLite schema, migrations | Backend |
| `src/hooks/useApi.ts` | Centralized API client | Frontend |
| `src/stores/useAuthStore.ts` | Auth state example | Frontend |
| `src/i18n/locales/*.json` | Translations (always update all 3) | Frontend |
| `package.json` | Scripts, dependencies | Config |
| `docker-compose.yml` | Container config | Config |
| `deploy/systemd/api-center.service` | systemd unit | Config |

---

## 🎓 Onboarding Tasks (Try These First)

1. **Add a simple UI feature**
   - [ ] Create new page following `AiProvidersPage.tsx` pattern
   - [ ] Add route to App.tsx
   - [ ] Add i18n keys for 3 languages
   - [ ] Test with `npm run dev`

2. **Fix a bug**
   - [ ] Reproduce issue locally with `npm run dev`
   - [ ] Check browser DevTools + server logs
   - [ ] Run `npm run lint` and `npm run type-check`
   - [ ] Verify fix in all 3 languages (if UI)

3. **Add an API endpoint**
   - [ ] Create route in `server/server.js`
   - [ ] Test with curl or Postman
   - [ ] Create API client in `src/services/`
   - [ ] Use in component via `useApi` hook

4. **Internationalize new text**
   - [ ] Add keys to all 3 locale files
   - [ ] Use `useTranslation()` hook in components
   - [ ] Test by switching language in footer

---

## ⚙️ Maintenance Notes

- **Dependencies**: Update quarterly; run `npm audit` monthly
- **SQLite**: `usage.db` grows indefinitely; consider archiving old records
- **Translations**: Ensure new strings added to all 3 locales (tests check this)
- **Performance**: Monitor build size; keep single-file output ~2-3 MB
- **Docker**: Rebuild after major dependency changes

---

## 🔗 Related Documentation

- **Chinese README**: [README_CN.md](../../README.md)
- **UI Documentation**: [UI.md](../../UI.md)
- **CLI-Proxy-API Project**: https://github.com/router-for-me/CLIProxyAPI

---

## 💡 For AI Agents: Quick Productivity Checklist

Before writing code, remember:
- [ ] Check `npm run type-check` and `npm run lint` pass locally first
- [ ] Test with `npm run dev` (frontend + backend together)
- [ ] i18n: Always update 3 locale JSON files for new user-facing text
- [ ] API calls: Use `useApi` hook (not direct axios)
- [ ] Styling: SCSS Modules for component scoping, Tailwind for responsiveness
- [ ] Stores: Use Zustand with `persist` for state that should survive page reload
- [ ] Routing: Use HashRouter (not BrowserRouter) for file-friendly URLs
- [ ] Error handling: Show toast notifications; log to console
- [ ] Build: Single-file output means no code-splitting; keep bundle reasonable

Good luck! 🚀
