ALTER TYPE "public"."payment_method" ADD VALUE 'BENEFIT_CARD';--> statement-breakpoint
CREATE TABLE "benefit_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"issuer" varchar(60),
	"last4" varchar(4),
	"credit_rule" varchar(20) DEFAULT 'LAST_BUSINESS_DAY' NOT NULL,
	"credit_day" smallint,
	"start_month" date NOT NULL,
	"end_month" date,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benefit_cards_rule" CHECK ("benefit_cards"."credit_rule" in ('LAST_BUSINESS_DAY','DAY_OF_MONTH')),
	CONSTRAINT "benefit_cards_day" CHECK (("benefit_cards"."credit_rule" = 'DAY_OF_MONTH') = ("benefit_cards"."credit_day" is not null)
    and ("benefit_cards"."credit_day" is null or "benefit_cards"."credit_day" between 1 and 31)),
	CONSTRAINT "benefit_cards_start_is_month" CHECK (extract(day from "benefit_cards"."start_month") = 1),
	CONSTRAINT "benefit_cards_end_after_start" CHECK ("benefit_cards"."end_month" is null or "benefit_cards"."end_month" >= "benefit_cards"."start_month")
);
--> statement-breakpoint
CREATE TABLE "benefit_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benefit_card_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"monthly_credit_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benefit_wallets_card_name" UNIQUE("benefit_card_id","name"),
	CONSTRAINT "benefit_wallets_credit_positive" CHECK ("benefit_wallets"."monthly_credit_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "tx_target";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "benefit_wallet_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "benefit_credit_month" date;--> statement-breakpoint
ALTER TABLE "benefit_cards" ADD CONSTRAINT "benefit_cards_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_wallets" ADD CONSTRAINT "benefit_wallets_benefit_card_id_benefit_cards_id_fk" FOREIGN KEY ("benefit_card_id") REFERENCES "public"."benefit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_benefit_wallet_id_benefit_wallets_id_fk" FOREIGN KEY ("benefit_wallet_id") REFERENCES "public"."benefit_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tx_benefit_credit_month" ON "transactions" USING btree ("benefit_wallet_id","benefit_credit_month") WHERE "transactions"."benefit_credit_month" is not null and "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tx_benefit_wallet" ON "transactions" USING btree ("benefit_wallet_id","posted_date") WHERE "transactions"."benefit_wallet_id" is not null;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_benefit_credit" CHECK ("transactions"."benefit_credit_month" is null
    or ("transactions"."benefit_wallet_id" is not null and "transactions"."kind" = 'INCOME' and extract(day from "transactions"."benefit_credit_month") = 1));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_target" CHECK (
    ("transactions"."payment_method" = 'CREDIT_CARD' and "transactions"."credit_card_id" is not null and "transactions"."bank_account_id" is null
       and "transactions"."benefit_wallet_id" is null and "transactions"."kind" = 'EXPENSE')
    or ("transactions"."payment_method"::text = 'BENEFIT_CARD' and "transactions"."benefit_wallet_id" is not null and "transactions"."bank_account_id" is null
       and "transactions"."credit_card_id" is null and "transactions"."kind" in ('INCOME','EXPENSE'))
    or ("transactions"."payment_method" <> 'CREDIT_CARD' and "transactions"."payment_method"::text <> 'BENEFIT_CARD'
       and "transactions"."credit_card_id" is null and "transactions"."benefit_wallet_id" is null and "transactions"."bank_account_id" is not null));