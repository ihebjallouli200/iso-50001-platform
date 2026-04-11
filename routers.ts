import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as energyDb from "./db_energy";
import * as energyCalc from "./energy_calculations";
import { canWriteEndpoint, ROLE_LABELS, type Role, type WriteAction } from "./auth_rbac";

function getCurrentRole(ctx: any): Role {
  const role = ctx?.user?.role as Role | undefined;
  if (!role || !(role in ROLE_LABELS)) {
    return "OPERATEUR";
  }
  return role;
}

function assertWriteAllowed(
  ctx: any,
  action: WriteAction,
) {
  const role = getCurrentRole(ctx);
  const exceptionApproved = Boolean(ctx?.user?.sensitiveWriteExceptionApproved);

  if (!canWriteEndpoint(role, action, { exceptionApproved })) {
    throw new Error(`Access denied for write action: ${action}`);
  }
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    meByToken: publicProcedure
      .input(z.object({ sessionToken: z.string().min(20) }))
      .query(async ({ input }) => {
        const user = await energyDb.getSessionUser(input.sessionToken);
        return user;
      }),

    login: publicProcedure
      .input(z.object({ username: z.string().min(3), password: z.string().min(8) }))
      .mutation(async ({ input, ctx }) => {
        const session = await energyDb.loginWithLocalAccount(input.username, input.password, {
          userAgent: ctx.req?.headers?.["user-agent"] as string | undefined,
          ipAddress: ctx.req?.ip,
        });

        if (!session) {
          throw new Error("Invalid username or password");
        }

        return session;
      }),

    roleMetadata: protectedProcedure.query(({ ctx }) => {
      const role = getCurrentRole(ctx);

      return {
        role,
        roleLabel: ROLE_LABELS[role],
      };
    }),

    logoutByToken: publicProcedure
      .input(z.object({ sessionToken: z.string().min(20) }))
      .mutation(async ({ input }) => {
        await energyDb.revokeSession(input.sessionToken);
        return { success: true } as const;
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      assertWriteAllowed(ctx, "LOGOUT");
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ============ MACHINE MANAGEMENT ============
  machines: router({
    list: protectedProcedure.query(async () => {
      return energyDb.getAllMachines();
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const result = await energyDb.getMachineById(input.id);
        return result[0] || null;
      }),

    create: protectedProcedure
      .input(z.object({
        siteId: z.string(),
        machineCode: z.string(),
        machineName: z.string(),
        machineType: z.string().optional(),
        location: z.string().optional(),
        nominalPower: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        assertWriteAllowed(ctx, "CREATE_MACHINE");
        const machineData: any = { ...input };
        if (input.nominalPower) machineData.nominalPower = String(input.nominalPower);
        return energyDb.createMachine(machineData);
      }),
  }),

  // ============ MEASUREMENTS & TIME-SERIES DATA ============
  measurements: router({
    getByMachine: protectedProcedure
      .input(z.object({
        machineId: z.number(),
        startDate: z.date(),
        endDate: z.date(),
        limit: z.number().default(1000),
      }))
      .query(async ({ input }) => {
        return energyDb.getMeasurementsByMachine(
          input.machineId,
          input.startDate,
          input.endDate,
          input.limit
        );
      }),
  }),

  // ============ ENERGY PERFORMANCE INDICATOR (EnPI) ============
  enpi: router({
    getLatest: protectedProcedure
      .input(z.object({ machineId: z.number() }))
      .query(async ({ input }) => {
        const result = await energyDb.getLatestEnPI(input.machineId);
        return result[0] || null;
      }),

    getHistory: protectedProcedure
      .input(z.object({
        machineId: z.number(),
        startDate: z.date(),
        endDate: z.date(),
        limit: z.number().default(100),
      }))
      .query(async ({ input }) => {
        return energyDb.getEnPIHistory(
          input.machineId,
          input.startDate,
          input.endDate,
          input.limit
        );
      }),
  }),

  // ============ PDCA CYCLE ============
  pdca: router({
    getCycles: protectedProcedure
      .input(z.object({ machineId: z.number(), limit: z.number().default(10) }))
      .query(async ({ input }) => {
        return energyDb.getPDCACyclesByMachine(input.machineId, input.limit);
      }),

    getCycle: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const result = await energyDb.getPDCACycle(input.id);
        return result[0] || null;
      }),
  }),

  // ============ ANOMALIES ============
  anomalies: router({
    getRecent: protectedProcedure
      .input(z.object({
        machineId: z.number(),
        hours: z.number().default(24),
        limit: z.number().default(50),
      }))
      .query(async ({ input }) => {
        return energyDb.getRecentAnomalies(input.machineId, input.hours, input.limit);
      }),
  }),

  // ============ RECOMMENDATIONS ============
  recommendations: router({
    getByMachine: protectedProcedure
      .input(z.object({ machineId: z.number(), limit: z.number().default(20) }))
      .query(async ({ input }) => {
        return energyDb.getRecommendationsByMachine(input.machineId, input.limit);
      }),
  }),

  // ============ ALERTS ============
  alerts: router({
    getUnread: protectedProcedure
      .input(z.object({ machineId: z.number().optional(), limit: z.number().default(50) }))
      .query(async ({ input }) => {
        return energyDb.getUnreadAlerts(input.machineId, input.limit);
      }),

    markAsRead: protectedProcedure
      .input(z.object({ alertId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        assertWriteAllowed(ctx, "MARK_ALERT_READ");
        return energyDb.markAlertAsRead(input.alertId);
      }),
  }),

  governance: router({
    approveBaseline: protectedProcedure
      .input(z.object({ baselineId: z.number(), reason: z.string().min(3) }))
      .mutation(async ({ ctx, input }) => {
        assertWriteAllowed(ctx, "VALIDATE_BASELINE");

        return {
          success: true,
          baselineId: input.baselineId,
          approvedBy: ctx.user?.id ?? null,
          reason: input.reason,
          timestamp: new Date().toISOString(),
        } as const;
      }),

    closePdcaCycle: protectedProcedure
      .input(z.object({ pdcaCycleId: z.number(), reason: z.string().min(3) }))
      .mutation(async ({ ctx, input }) => {
        assertWriteAllowed(ctx, "CLOSE_PDCA");

        return {
          success: true,
          pdcaCycleId: input.pdcaCycleId,
          closedBy: ctx.user?.id ?? null,
          reason: input.reason,
          timestamp: new Date().toISOString(),
        } as const;
      }),

    exportAuditReport: protectedProcedure
      .input(z.object({ from: z.date(), to: z.date() }))
      .mutation(async ({ ctx, input }) => {
        assertWriteAllowed(ctx, "EXPORT_AUDIT_REPORT");

        return {
          success: true,
          requestedBy: ctx.user?.id ?? null,
          period: {
            from: input.from.toISOString(),
            to: input.to.toISOString(),
          },
          generatedAt: new Date().toISOString(),
        } as const;
      }),
  }),
});

export type AppRouter = typeof appRouter;
