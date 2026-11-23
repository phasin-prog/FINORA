import Decimal from 'decimal.js';
import {
  assertPositiveAmount,
  sumDecimals,
  toDecimal,
  toNumericString,
} from '@/lib/utilities/money';
import type {
  AccountClass,
  Category,
  FinancialAccount,
  JournalEntryDraft,
  JournalLine,
  JournalLineInput,
  TransactionType,
} from '@/types/financial';

export class AccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountingError';
  }
}

export interface BuildJournalInput {
  householdId: string;
  transactionId: string;
  transactionType: TransactionType;
  amount: string;
  currencyCode: string;
  transactionDate: string;
  description: string;
  account: FinancialAccount;
  category?: Category | null;
  toAccount?: FinancialAccount | null;
}

/**
 * Validates double-entry invariants:
 * 1. At least 2 journal lines
 * 2. Non-negative debit and credit, mutually exclusive per line, not both zero
 * 3. Total Debit === Total Credit (exact Decimal equality)
 */
export function validateJournalLines(lines: JournalLineInput[]): {
  totalDebit: Decimal;
  totalCredit: Decimal;
} {
  if (lines.length < 2) {
    throw new AccountingError(
      `A journal entry must have at least 2 lines (received ${lines.length}).`
    );
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const debit = toDecimal(line.debit);
    const credit = toDecimal(line.credit);

    if (debit.lt(0) || credit.lt(0)) {
      throw new AccountingError(`Line ${i + 1} has negative debit or credit.`);
    }
    if (debit.gt(0) && credit.gt(0)) {
      throw new AccountingError(
        `Line ${i + 1} cannot have both debit and credit > 0.`
      );
    }
    if (debit.eq(0) && credit.eq(0)) {
      throw new AccountingError(
        `Line ${i + 1} must have either debit > 0 or credit > 0.`
      );
    }
  }

  const totalDebit = sumDecimals(lines.map((l) => l.debit));
  const totalCredit = sumDecimals(lines.map((l) => l.credit));

  if (!totalDebit.eq(totalCredit)) {
    throw new AccountingError(
      `Journal entry is unbalanced: Debit (${totalDebit.toFixed(4)}) != Credit (${totalCredit.toFixed(4)}).`
    );
  }

  return { totalDebit, totalCredit };
}

/**
 * Converts a user-facing single-entry transaction into a balanced
 * double-entry journal entry (Section 3.1 & 3.2).
 */
export function buildJournalForTransaction(
  input: BuildJournalInput
): JournalEntryDraft {
  const amountDec = assertPositiveAmount(input.amount);
  const amountStr = toNumericString(amountDec, 4);
  const zeroStr = '0.0000';
  const currency = input.currencyCode.toUpperCase();

  if (input.account.household_id !== input.householdId) {
    throw new AccountingError('Account does not belong to the target household.');
  }

  let lines: JournalLineInput[];

  if (input.transactionType === 'income') {
    if (!input.category || input.category.category_type !== 'INCOME') {
      throw new AccountingError('Income transaction requires an INCOME category.');
    }
    if (!input.category.ledger_account_id) {
      throw new AccountingError('Income category is missing a ledger_account_id.');
    }

    // Debit Asset/Account, Credit Income
    lines = [
      {
        ledger_account_id: input.account.ledger_account_id,
        debit: amountStr,
        credit: zeroStr,
        currency_code: currency,
        description: input.description || `Income to ${input.account.name}`,
      },
      {
        ledger_account_id: input.category.ledger_account_id,
        debit: zeroStr,
        credit: amountStr,
        currency_code: currency,
        description: input.description || input.category.name,
      },
    ];
  } else if (input.transactionType === 'expense') {
    if (!input.category || input.category.category_type !== 'EXPENSE') {
      throw new AccountingError('Expense transaction requires an EXPENSE category.');
    }
    if (!input.category.ledger_account_id) {
      throw new AccountingError('Expense category is missing a ledger_account_id.');
    }

    // Debit Expense, Credit Asset (Bank/Cash) or Liability (Credit Card)
    lines = [
      {
        ledger_account_id: input.category.ledger_account_id,
        debit: amountStr,
        credit: zeroStr,
        currency_code: currency,
        description: input.description || input.category.name,
      },
      {
        ledger_account_id: input.account.ledger_account_id,
        debit: zeroStr,
        credit: amountStr,
        currency_code: currency,
        description: input.description || `Paid from ${input.account.name}`,
      },
    ];
  } else if (input.transactionType === 'transfer') {
    if (!input.toAccount) {
      throw new AccountingError('Transfer transaction requires a destination account.');
    }
    if (input.toAccount.household_id !== input.householdId) {
      throw new AccountingError('Destination account belongs to a different household.');
    }
    if (input.account.id === input.toAccount.id) {
      throw new AccountingError('Cannot transfer to the same account.');
    }

    // Debit Destination Account, Credit Source Account
    // Note: Never touches Income or Expense ledger accounts.
    lines = [
      {
        ledger_account_id: input.toAccount.ledger_account_id,
        debit: amountStr,
        credit: zeroStr,
        currency_code: currency,
        description:
          input.description || `Transfer from ${input.account.name} to ${input.toAccount.name}`,
      },
      {
        ledger_account_id: input.account.ledger_account_id,
        debit: zeroStr,
        credit: amountStr,
        currency_code: currency,
        description:
          input.description || `Transfer to ${input.toAccount.name}`,
      },
    ];
  } else {
    throw new AccountingError(`Unsupported transaction type: ${input.transactionType}`);
  }

  validateJournalLines(lines);

  return {
    household_id: input.householdId,
    transaction_id: input.transactionId,
    entry_date: input.transactionDate,
    description: input.description,
    status: 'posted',
    lines,
  };
}

/**
 * Creates a counter-balancing reversal journal entry (Section 10 Rule 4).
 * Posted journal entries are never edited directly.
 */
export function buildReversalJournal(params: {
  householdId: string;
  reversalTransactionId: string;
  reversalDate: string;
  originalDescription: string;
  originalLines: JournalLineInput[];
  reason?: string;
}): JournalEntryDraft {
  validateJournalLines(params.originalLines);

  const reversedLines: JournalLineInput[] = params.originalLines.map((line) => ({
    ledger_account_id: line.ledger_account_id,
    debit: line.credit,
    credit: line.debit,
    currency_code: line.currency_code,
    description: `Reversal: ${line.description}`,
  }));

  validateJournalLines(reversedLines);

  return {
    household_id: params.householdId,
    transaction_id: params.reversalTransactionId,
    entry_date: params.reversalDate,
    description: params.reason
      ? `Reversal (${params.reason}): ${params.originalDescription}`
      : `Reversal: ${params.originalDescription}`,
    status: 'posted',
    lines: reversedLines,
  };
}

/**
 * Derives account balance strictly from opening_balance + posted journal lines
 * (Section 4.2.B & Section 10 Rule 1).
 */
export function calculateAccountBalance(
  openingBalance: string,
  accountClass: AccountClass,
  postedLines: Array<Pick<JournalLine, 'debit' | 'credit'>>
): Decimal {
  const opening = toDecimal(openingBalance);
  const totalDebit = sumDecimals(postedLines.map((l) => l.debit));
  const totalCredit = sumDecimals(postedLines.map((l) => l.credit));

  if (accountClass === 'ASSET' || accountClass === 'EXPENSE') {
    return opening.plus(totalDebit).minus(totalCredit);
  }
  // LIABILITY, EQUITY, INCOME have normal Credit balance
  return opening.plus(totalCredit).minus(totalDebit);
}

/**
 * Computes Available Cash, Total Assets, Total Liabilities, and Net Worth
 * separately as required by Section 10.
 */
export function calculateFinancialPosition(
  accounts: Array<{
    account_type: FinancialAccount['account_type'];
    account_class: AccountClass;
    balance: Decimal;
  }>,
  extraAssets: Decimal[] = [],
  extraLiabilities: Decimal[] = []
): {
  availableCash: Decimal;
  totalAssets: Decimal;
  totalLiabilities: Decimal;
  netWorth: Decimal;
} {
  let availableCash = new Decimal(0);
  let totalAssets = sumDecimals(extraAssets);
  let totalLiabilities = sumDecimals(extraLiabilities);

  for (const acc of accounts) {
    if (acc.account_class === 'ASSET') {
      totalAssets = totalAssets.plus(acc.balance);
      if (
        acc.account_type === 'cash' ||
        acc.account_type === 'bank' ||
        acc.account_type === 'wallet'
      ) {
        availableCash = availableCash.plus(acc.balance);
      }
    } else if (acc.account_class === 'LIABILITY') {
      totalLiabilities = totalLiabilities.plus(acc.balance);
    }
  }

  return {
    availableCash,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets.minus(totalLiabilities),
  };
}
