/**
 * Mock energy data for NEXT_PUBLIC_OPENFEED_MOCK=true
 * 24 months of realistic Australian household energy data:
 *   - Electricity account with solar/export + controlled load meter
 *   - Gas account
 * Usage: import { getMockEnergyData } from "@/lib/mock"
 */

import type {
  EnergyAccount,
  EnergyMeter,
  EnergyInvoice,
} from "./openfeed";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Seasonal electricity usage (kWh/day) — higher in summer (cooling) + winter (heating)
function seasonalKwh(month: number): number {
  // month 0-indexed. Peaks Jan/Feb (summer AU) and Jul (winter)
  const base = [22, 21, 18, 15, 16, 18, 22, 20, 16, 14, 15, 20][month];
  return base + (Math.random() - 0.5) * 3;
}

// Solar export (kWh/day) — higher in summer, near zero in winter
function seasonalSolarExport(month: number): number {
  const base = [12, 11, 9, 6, 4, 3, 3, 4, 7, 9, 10, 12][month];
  return Math.max(0, base + (Math.random() - 0.5) * 2);
}

// Gas usage (MJ/day) — higher in winter
function seasonalGasMj(month: number): number {
  const base = [8, 8, 12, 18, 24, 28, 30, 26, 20, 14, 10, 8][month];
  return base + (Math.random() - 0.5) * 4;
}

// AUD electricity rate ($/kWh) — gradual increase over 2 years
function electricityRate(invoiceIndex: number): number {
  return 0.28 + invoiceIndex * 0.002 + (Math.random() - 0.5) * 0.01;
}

// AUD gas rate ($/MJ)
function gasRate(invoiceIndex: number): number {
  return 0.024 + invoiceIndex * 0.0003 + (Math.random() - 0.5) * 0.001;
}

// Daily supply charge AUD/day
const ELEC_SUPPLY = 1.05;
const GAS_SUPPLY = 0.72;

// Feed-in tariff AUD/kWh
const FIT = 0.05;

// ─── Build dataset ────────────────────────────────────────────────────────────

const NUM_INVOICES = 24; // 24 months of history
// Reference point: invoices end at "today" (2026-11-07), one per month
const TODAY = new Date("2026-11-07");

// Account IDs
const ELEC_ACCOUNT_ID = "mock-elec-acct-001";
const GAS_ACCOUNT_ID = "mock-gas-acct-002";
const ELEC_METER_ID = "mock-elec-meter-001";
const SOLAR_METER_ID = "mock-solar-meter-001"; // same NMI, import vs export registers
const CL_METER_ID = "mock-cl-meter-001"; // controlled load (hot water)
const GAS_METER_ID = "mock-gas-meter-001";

// ─── Accounts ─────────────────────────────────────────────────────────────────

export const mockElecAccount: EnergyAccount = {
  providerId: "mock-provider-agl",
  providerName: "AGL Energy",
  accountId: ELEC_ACCOUNT_ID,
  displayName: "Home Electricity",
  status: "ACTIVE",
  accountNumber: "4200123456",
  creationDate: "2020-06-01",
  payloadVersion: 1,
  plans: [
    {
      planOverview: {
        displayName: "AGL Solar Savers",
        startDate: "2023-01-01",
      },
    },
  ],
};

export const mockGasAccount: EnergyAccount = {
  providerId: "mock-provider-agl",
  providerName: "AGL Energy",
  accountId: GAS_ACCOUNT_ID,
  displayName: "Home Gas",
  status: "ACTIVE",
  accountNumber: "4200123457",
  creationDate: "2020-06-01",
  payloadVersion: 1,
  plans: [
    {
      planOverview: {
        displayName: "AGL Everyday Gas",
        startDate: "2023-01-01",
      },
    },
  ],
};

// ─── Meters ───────────────────────────────────────────────────────────────────

export const mockElecMeter: EnergyMeter = {
  meterId: ELEC_METER_ID,
  nationalMeteringId: "6102345678",
  status: "ACTIVE",
  detectedReadType: "interval",
  jurisdictionCode: "NSW",
  servicePointClassification: "SMALL",
  isGenerator: true,
};

export const mockClMeter: EnergyMeter = {
  meterId: CL_METER_ID,
  nationalMeteringId: "6102345678",
  status: "ACTIVE",
  detectedReadType: "daily",
  jurisdictionCode: "NSW",
  servicePointClassification: "SMALL",
  isGenerator: false,
};

export const mockGasMeter: EnergyMeter = {
  meterId: GAS_METER_ID,
  nationalMeteringId: undefined,
  status: "ACTIVE",
  detectedReadType: "daily",
  jurisdictionCode: "NSW",
  servicePointClassification: "SMALL",
  isGenerator: false,
};

// ─── Invoices + usage per period ─────────────────────────────────────────────

export interface MockInvoicePeriod {
  invoice: EnergyInvoice;
  /** kWh consumed (import) for the billing period */
  consumptionKwh: number;
  /** kWh exported (solar) for the billing period — negative = export */
  exportKwh: number;
  /** Controlled load kWh */
  clKwh: number;
  /** Gas MJ consumed */
  gasMj: number;
}

function buildPeriods(): {
  elecPeriods: MockInvoicePeriod[];
  gasPeriods: MockInvoicePeriod[];
} {
  const elecPeriods: MockInvoicePeriod[] = [];
  const gasPeriods: MockInvoicePeriod[] = [];

  // Build invoice date boundaries (monthly, from 24 months ago to today)
  const boundaries: Date[] = [];
  for (let i = NUM_INVOICES; i >= 0; i--) {
    boundaries.push(addMonths(TODAY, -i));
  }

  for (let i = 0; i < NUM_INVOICES; i++) {
    const startDate = boundaries[i];
    const endDate = boundaries[i + 1];
    const issueDate = endDate; // invoice issued on last day of period
    const dueDate = addMonths(endDate, 0);
    dueDate.setDate(dueDate.getDate() + 14); // due 2 weeks after issue

    const days =
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const month = startDate.getMonth();
    const invoiceIndex = i;

    // Electricity
    const dailyImport = seasonalKwh(month);
    const dailyExport = seasonalSolarExport(month);
    const dailyCl = 3.5 + (Math.random() - 0.5) * 0.5; // hot water
    const consumptionKwh = dailyImport * days;
    const exportKwh = dailyExport * days;
    const clKwh = dailyCl * days;
    const rate = electricityRate(invoiceIndex);
    const importCost = consumptionKwh * rate;
    const clCost = clKwh * (rate * 0.7); // CL is cheaper rate
    const exportCredit = exportKwh * FIT;
    const supplyCost = days * ELEC_SUPPLY;
    const elecNet = importCost + clCost - exportCredit + supplyCost;
    const elecGst = elecNet * 0.1;
    const elecTotal = elecNet + elecGst;

    const isPaid = i < NUM_INVOICES - 2;
    const isOverdue = i === NUM_INVOICES - 3 && Math.random() < 0.1; // occasional overdue

    elecPeriods.push({
      invoice: {
        invoiceNumber: `AGL-E-${2024 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`,
        issueDate: isoDate(issueDate),
        dueDate: isoDate(dueDate),
        invoiceAmount: Math.round(elecTotal * 100) / 100,
        gstAmount: Math.round(elecGst * 100) / 100,
        balanceAtIssue: 0,
        paymentStatus: isOverdue ? "OVERDUE" : isPaid ? "PAID" : "DUE",
        meterIds: [ELEC_METER_ID, CL_METER_ID],
      },
      consumptionKwh: Math.round(consumptionKwh * 10) / 10,
      exportKwh: Math.round(exportKwh * 10) / 10,
      clKwh: Math.round(clKwh * 10) / 10,
      gasMj: 0,
    });

    // Gas
    const dailyGas = seasonalGasMj(month);
    const gasMj = dailyGas * days;
    const gRate = gasRate(invoiceIndex);
    const gasCost = gasMj * gRate;
    const gasSupply = days * GAS_SUPPLY;
    const gasNet = gasCost + gasSupply;
    const gasGst = gasNet * 0.1;
    const gasTotal = gasNet + gasGst;

    gasPeriods.push({
      invoice: {
        invoiceNumber: `AGL-G-${2024 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`,
        issueDate: isoDate(issueDate),
        dueDate: isoDate(dueDate),
        invoiceAmount: Math.round(gasTotal * 100) / 100,
        gstAmount: Math.round(gasGst * 100) / 100,
        balanceAtIssue: 0,
        paymentStatus: isPaid ? "PAID" : "DUE",
        meterIds: [GAS_METER_ID],
      },
      consumptionKwh: 0,
      exportKwh: 0,
      clKwh: 0,
      gasMj: Math.round(gasMj * 10) / 10,
    });
  }

  return { elecPeriods, gasPeriods };
}

// ─── Exported dataset ─────────────────────────────────────────────────────────

const { elecPeriods, gasPeriods } = buildPeriods();

export const mockData = {
  accounts: {
    electricity: mockElecAccount,
    gas: mockGasAccount,
  },
  meters: {
    [ELEC_ACCOUNT_ID]: [mockElecMeter, mockClMeter],
    [GAS_ACCOUNT_ID]: [mockGasMeter],
  },
  invoices: {
    [ELEC_ACCOUNT_ID]: elecPeriods.map((p) => p.invoice),
    [GAS_ACCOUNT_ID]: gasPeriods.map((p) => p.invoice),
  },
  /** Full period data for aggregate computation */
  periods: {
    [ELEC_ACCOUNT_ID]: elecPeriods,
    [GAS_ACCOUNT_ID]: gasPeriods,
  },
  lastUpdated: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
};

export type MockData = typeof mockData;
