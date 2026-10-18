# ALCO — Complete App Development Instructions & Features

Production SaaS Blueprint

Version 1.0 · October 2026

App Name: ALCO (AI Lab for Code Operations)
Tagline: Think it. Build it. Launch it. Product Type: AI-Powered Workspace & Autonomous App Builder Platform: Web Application + Mobile Responsive PWA Languages: မြန်မာ + English

ALCO ကို AI Chatbot သာမက AI နဲ့ Website တွေ တည်ဆောက်နိုင်၊ Code ရေးနိုင်၊ Project တွေ စီမံနိုင်၊ Test လုပ်နိုင်ပြီး Deploy ပါလုပ်နိုင်တဲ့ AI Development Platform အဖြစ် ဖန်တီးမယ်။

ဒီ Instructions တွေကို Developer Team ဒါမှမဟုတ် Claude Code, Cursor, Codex စတဲ့ Coding AI တွေကို ပေးပြီး အကောင်အထည်ဖော်နိုင်အောင် ရေးထားတယ်။

## 1. App ရဲ့ အဓိက Features

01. AI Brain

AI Model မျိုးစုံ ချိတ်ဆက်နိုင်မယ်။ Chat History, Streaming Response, File Upload, မြန်မာဘာသာနဲ့ Prompt နားလည်မှုတွေ ပါမယ်။

Core MVP

02. AI App Builder

Prompt ရေးပြီး Website ဖန်တီးမယ်။ Source Code, Live Preview, File Explorer, Code Editor နဲ့ Version History ပါမယ်။

Core MVP

03. Multi-Agent Team

Planner, Developer, Designer, Tester, Reviewer Agent တွေက Project တစ်ခုအတွက် တာဝန်ခွဲလုပ်မယ်။

Phase 2

04. Secure Sandbox

AI ရေးတဲ့ Code ကို သီးခြား Container/MicroVM ထဲ Run မယ်။ Logs, Resource Limits, Timeout နဲ့ Execution Controls ပါမယ်။

Core MVP

05. Deployment Center

GitHub Export, Hosting Integration, Environment Variables, Build Logs, Deployment History နဲ့ Rollback ပါမယ်။

Phase 2

06. AI Marketplace

AI Tools, Templates, Plugins တွေကို Install/Publish လုပ်နိုင်မယ်။ Public Marketplace နဲ့ Creator Dashboard ပါမယ်။

Phase 3

## 2. Application Pages

| Page | လုပ်ဆောင်ချက် |
|---|---|
| / | Landing Page |
| /login | Login / Sign Up |
| /dashboard | Overview & Recent Projects |
| /chat | AI Assistant |
| /projects | Project Management |
| /builder/[id] | AI App Builder |
| /sandbox | Execution History |
| /deployments | Deployments |
| /marketplace | AI Tools & Templates |
| /billing | Plans, Credits & Payments |
| /settings | Profile, API Keys, Preferences |
| /admin | Admin Dashboard |

## 3. Technology Stack

| Layer | Recommended Technology |
|---|---|
| Frontend | Next.js App Router + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Animation | Framer Motion / Motion |
| Backend API | Next.js API + Dedicated Workers |
| Database | PostgreSQL via Supabase |
| Authentication | Supabase Auth |
| AI Integration | Provider Adapter Architecture |
| Code Editor | Monaco Editor |
| Code Execution | Isolated Sandbox Workers |
| Job Queue | Redis + BullMQ |
| File Storage | S3-compatible Object Storage |
| Monitoring | Sentry + OpenTelemetry |
| Deployment | Vercel or Container Hosting |
| Payments | Stripe or supported regional provider |

Next.js App Router က modern React architecture အတွက် သင့်တော်ပြီး Supabase Auth + PostgreSQL RLS က User တစ်ယောက်ချင်းစီရဲ့ Data Access ကို ထိန်းချုပ်ဖို့ အသုံးဝင်တယ်။

## 4. UI/UX Design Instructions

ALCO Design System

Dark-first

| Token | Value |
|---|---|
| Base | #080B16 |
| Surface | #171C30 |
| Primary | #8257F5 |
| Accent | #22D3EE |
| Text | #F3F4F6 |

Design Requirements

* Premium Dark Mode ကို Default သတ်မှတ်မယ်။
* Light Mode လည်း ပါမယ်။
* Desktop မှာ Collapsible Sidebar + Main Workspace ဖြစ်မယ်။
* Mobile မှာ Responsive Navigation ပါမယ်။
* Burmese Unicode ကို Font Rendering မှန်အောင် ထောက်ပံ့မယ်။
* Accessibility, Keyboard Shortcuts, Loading Skeletons, Empty States တွေ ပါမယ်။

## 5. AI App Builder Workflow

User တစ်ယောက် App ဖန်တီးတဲ့အခါ အောက်ပါ Workflow အတိုင်း အလုပ်လုပ်ရမယ်။

User Prompt → "Build a modern online shop" → Plan (Requirements & Tasks) → Generate (Files & Source Code) → Test (Build & Security Checks) → Preview (Live Application) → Review & Deploy (User Approval → Production Deployment)

User က Generate ပြီးသွားတဲ့ App ကို Chat ထဲကနေ ပြန်ပြင်ခိုင်းနိုင်ရမယ်။ ဥပမာ "Header ကို Purple ပြောင်းပေး" လို့ ပြောရင် ရှိပြီးသား Project Files ကို ထိန်းသိမ်းပြီး သက်ဆိုင်ရာ Code ကိုပဲ ပြင်ရမယ်။

## 6. Database Structure

MVP အတွက် အနည်းဆုံး အောက်ပါ Tables တွေ လိုမယ်။

| Table | Purpose |
|---|---|
| profiles | User Profile & Roles |
| projects | Project Metadata |
| project_files | Source File References |
| project_versions | Snapshots & Rollback |
| conversations | Chat Sessions |
| messages | Chat Messages |
| agent_runs | AI Tasks & Status |
| sandbox_runs | Code Execution Records |
| deployments | Deployment History |
| usage_events | AI Token & Resource Usage |
| subscriptions | Plans & Billing |
| audit_logs | Security & Action Logs |

Project source files ကို Object Storage သို့မဟုတ် Git-backed Storage ထဲ ထားပြီး Database မှာ Metadata, Ownership နဲ့ Version References သိမ်းမယ်။

## 7. Production Security Requirements

ဒီအပိုင်းက အလွန်အရေးကြီးတယ်။ AI-generated Code ကို Server ပေါ်မှာ တိုက်ရိုက် Run မလုပ်ရဘူး။

* User Code ကို Main App Server နဲ့ သီးခြားထားတဲ့ Ephemeral Sandbox ထဲမှာပဲ Execute လုပ်မယ်။
* Sandbox တွေမှာ CPU, RAM, Disk, Network, Runtime Limit တွေ သတ်မှတ်မယ်။
* Host Docker Socket, Host Filesystem နဲ့ Production Secrets တွေကို Sandbox မှ Access မပေးရ။
* Sensitive Actions, External Integrations နဲ့ Production Deployment အတွက် User Approval လိုမယ်။
* API Keys တွေကို Server-side Encrypted Storage ထဲ သိမ်းမယ်။ Client UI မှာ Full Key ပြန်မပြရ။
* Authorization, Database RLS, Rate Limiting, Audit Logs, Abuse Prevention, Backups, Cost Limits တွေ ထည့်မယ်။
* Unit Test, Integration Test, End-to-End Test, Dependency Scanning နဲ့ Security Review မပြီးမချင်း Production Release မလုပ်ရ။

## 8. Development Roadmap

Phase 1 — Functional MVP

Authentication, Dashboard, AI Chat, Project Creation, AI Code Generation, Editor, Safe Preview, Project Save, Usage Limits နဲ့ Basic Admin။

Phase 2 — Production SaaS

Multi-Agent Workflow, Secure Sandboxes, GitHub Export, Deployment Integrations, Billing, Version Rollback နဲ့ Monitoring။

Phase 3 — Platform Expansion

Marketplace, Plugin SDK, Team Workspaces, Public API, Templates, Custom Domains နဲ့ Collaboration။

## 9. Master Development Instructions (Coding AI အတွက်)

(SHIWEOS — MASTER DEVELOPMENT INSTRUCTIONS — English, copy/paste for coding AI)

ROLE

You are a senior full-stack engineer, product architect, UI/UX designer, database engineer, DevOps engineer, and application security engineer.

Build ALCO, a production-oriented AI workspace and AI-powered web application builder.

Brand: ALCO
Tagline: Think it. Build it. Launch it.
Target Users: Developers, founders, creators, students, and non-technical users.
Languages: English and Myanmar (Burmese).

PRIMARY OBJECTIVE

Build a real, functional SaaS application, not merely a static website, landing page, or clickable prototype.

The application must allow authenticated users to create projects, describe web applications using natural language, generate and edit source code, preview generated applications safely, save their work, and manage projects.

Implement the functional MVP before advanced platform features.

TECHNOLOGY

* Next.js App Router with TypeScript
* React
* Tailwind CSS and shadcn/ui
* PostgreSQL with Supabase
* Supabase Authentication
* Monaco Editor
* Provider-agnostic AI integration
* Dedicated sandbox execution service
* Redis and BullMQ for background jobs
* S3-compatible file storage
* Playwright for end-to-end testing

Use maintained, compatible dependency versions and lock dependencies.

DESIGN SYSTEM

Create a premium, professional interface inspired by modern developer tools.

Visual direction:

* Dark-first interface
* Primary color: #8257F5
* Accent color: #22D3EE
* Background: #080B16
* Surface: #171C30
* Text: #F3F4F6
* Rounded panels
* Subtle transitions
* Readable typography
* Responsive dashboard layout
* Collapsible sidebar
* High-quality loading and error states
* Full English/Myanmar localization
* Correct Myanmar Unicode rendering
* Accessible controls and keyboard navigation

Do not directly clone another product's UI or branding.

MVP MODULES

1. Authentication — secure sign-up, sign-in, sign-out, session management, password reset, protected routes.
2. Dashboard — recent projects, project creation, activity history, AI usage, quick actions.
3. AI Chat — multi-turn conversations, streaming responses, configurable models, message history, markdown rendering, recoverable API errors.
4. Project Management — create, rename, organize, open, delete projects; every project belongs to its authorized owner.
5. AI App Builder — (1) receive requirements, (2) generate structured plan, (3) generate multi-file app, (4) validate file structure, (5) save files + version snapshot, (6) run build/test in isolated env, (7) show errors/logs, (8) safe live preview, (9) follow-up edits, (10) apply edits preserving unrelated files, (11) rollback to snapshots. Never pretend generation/tests/preview/deployment succeeded without verification.
6. Code Workspace — file explorer, Monaco editor, tabs, preview area, chat panel, error console, save indicator, version history.
7. Secure Execution — independently isolated environment; non-privileged, strong isolation, restricted FS, no host secrets, network restrictions, CPU/memory/storage/time limits, cleanup, per-user quotas, structured logs. Never execute arbitrary user-generated shell on the production host.
8. Settings — profile, locale, AI model config, secure user-provided API credentials.
9. Admin Dashboard — authorization-protected views: users, projects, execution failures, usage, health.

DATA MODEL

Migrations + indexes for: profiles, projects, project_files, project_versions, conversations, messages, agent_runs, sandbox_runs, usage_events, deployments, subscriptions, audit_logs. Foreign keys, ownership validation, Row Level Security.

BACKEND REQUIREMENTS

Modular architecture; strict validation; server-side authorization on every protected endpoint; secure secrets; retryable background tasks; idempotency; structured API errors; streaming; usage metering; AI spending controls; rate limiting; centralized error monitoring.

SECURITY REQUIREMENTS

Treat all AI output, generated code, prompts, uploads, tool results as untrusted. Protect against prompt injection, unauthorized tool execution, cross-user data access, SSRF, path traversal, resource exhaustion. Explicit authorization before modifying external resources or deploying. Never expose DB credentials or AI keys to browsers/sandboxes.

DELIVERY REQUIREMENTS

Source code, migrations, .env example, README, architecture docs, API docs, unit+integration tests, e2e tests, local dev config, deployment instructions, production readiness checklist.

IMPLEMENTATION ORDER

1. Repository and app structure. 2. Design system + responsive shell. 3. Auth + migrations. 4. Projects + conversations. 5. AI provider abstraction. 6. Multi-file generation pipeline. 7. Editor + versioning. 8. Sandbox execution + preview. 9. Monitoring, limits, admin. 10. Testing, docs, deploy config.

After each milestone run relevant checks, explain failures, report what actually works.

ACCEPTANCE CRITERIA

MVP complete only when: real user can register/sign in; create+save project; AI generates real multi-file code; inspect+edit; isolated preview runs; follow-up edits; rollback; no cross-user access; meaningful errors; tests pass; deployable via docs.

FUTURE PHASES

Multi-agent orchestration, GitHub integration, managed deployment, billing, teams, plugin marketplace. Avoid unnecessary complexity before core workflow is stable.

FINAL DIRECTIVE: Prioritize functionality, maintainability, security, clean UX. Never fake responses or mockups. Clearly distinguish implemented vs planned.

## 10. MVP အတွက် Success Criteria

ALCO Version 1 ကို Launch လုပ်ဖို့ ဒီ (၅) ချက် အမှန်တကယ် အလုပ်လုပ်ရမယ်။

- [ ] User Account ဖွင့်ပြီး Login ဝင်နိုင်ခြင်း
- [ ] Prompt တစ်ခုကနေ အမှန်တကယ် Source Code ထုတ်နိုင်ခြင်း
- [ ] Generated Website ကို Safe Live Preview ကြည့်နိုင်ခြင်း
- [ ] AI ကို ပြန်ပြင်ခိုင်းပြီး Project သိမ်းနိုင်ခြင်း
- [ ] User Data လုံခြုံပြီး Errors တွေကို စနစ်တကျ ကိုင်တွယ်နိုင်ခြင်း

ငါ့အကြံပြုချက်က ALCO ကို အစကတည်းက Features အကုန်ထည့်ပြီး မတည်ဆောက်ဘဲ၊ AI App Builder ကို အဓိက Product အဖြစ် အရင် Launch လုပ်ဖို့ပါ။ အဲဒီ Core ကောင်းမှ Agent Team, Hosting နဲ့ Marketplace ကို ချဲ့မယ်။

ဒီ Blueprint က တည်ဆောက်ရေးအတွက် အခြေခံသတ်မှတ်ချက်ဖြစ်ပြီး Production-ready ဖြစ်ဖို့ တကယ့် Infrastructure, API Credentials, Security Testing နဲ့ Deployment Verification တွေ ထပ်လိုအပ်မယ်။

နောက်ဆုံးမှာ ALCO ရဲ့ အရေးကြီးဆုံးရည်မှန်းချက်က "မြန်မာလို စာတစ်ကြောင်းရေးရုံနဲ့ ကိုယ်ပိုင် Web App တစ်ခု တကယ်ဖန်တီးနိုင်တဲ့ Platform" ဖြစ်လာဖို့ပဲ।

---
*Source: user-pasted blueprint, 2026-10-18. Saved verbatim as reference.*
