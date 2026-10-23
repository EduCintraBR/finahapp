CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"lender" varchar(80),
	"principal_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"installment_count" smallint NOT NULL,
	"received_date" date NOT NULL,
	"first_due_date" date NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "loans_principal_positive" CHECK ("loans"."principal_cents" > 0),
	CONSTRAINT "loans_total_covers_principal" CHECK ("loans"."total_cents" >= "loans"."principal_cents"),
	CONSTRAINT "loans_installments" CHECK ("loans"."installment_count" between 1 and 120 and "loans"."total_cents" >= "loans"."installment_count")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "loan_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "loan_installment_number" smallint;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tx_loan_installment_unique" ON "transactions" USING btree ("loan_id","loan_installment_number") WHERE "transactions"."loan_installment_number" is not null and "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tx_loan" ON "transactions" USING btree ("loan_id") WHERE "transactions"."loan_id" is not null;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_loan_installment" CHECK ("transactions"."loan_installment_number" is null
    or ("transactions"."loan_id" is not null and "transactions"."kind" = 'EXPENSE' and "transactions"."loan_installment_number" >= 1));