"use client";

import { createAuthClient } from "better-auth/react";

// Talks to the same-origin /api/auth handler by default.
export const authClient = createAuthClient();
