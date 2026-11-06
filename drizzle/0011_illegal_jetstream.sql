CREATE TYPE "public"."stock_medicine_form" AS ENUM('TABLET', 'CAPSULE', 'SACHET', 'SUPPOSITORY', 'SYRUP', 'DROPS', 'SOLUTION', 'OINTMENT', 'CREAM', 'SPRAY', 'EYE_DROPS', 'INJECTABLE', 'OTHER');--> statement-breakpoint
ALTER TYPE "public"."stock_lot_origin" ADD VALUE 'OPENED';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_kind" ADD VALUE 'OPEN_OUT';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_kind" ADD VALUE 'OPEN_IN';--> statement-breakpoint
CREATE TABLE "stock_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_people_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "stock_product_people" (
	"product_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "stock_product_people_product_id_person_id_pk" PRIMARY KEY("product_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_direction";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_repack_lot";--> statement-breakpoint
ALTER TABLE "stock_products" ADD COLUMN "is_medicine" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_products" ADD COLUMN "active_ingredient" varchar(120);--> statement-breakpoint
ALTER TABLE "stock_products" ADD COLUMN "strength" varchar(60);--> statement-breakpoint
ALTER TABLE "stock_products" ADD COLUMN "medicine_form" "stock_medicine_form";--> statement-breakpoint
ALTER TABLE "stock_products" ADD COLUMN "open_shelf_life_days" smallint;--> statement-breakpoint
ALTER TABLE "stock_product_people" ADD CONSTRAINT "stock_product_people_product_id_stock_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."stock_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_product_people" ADD CONSTRAINT "stock_product_people_person_id_stock_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."stock_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_product_people_person" ON "stock_product_people" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_direction" CHECK (("stock_movements"."kind"::text in ('IN', 'REPACK_IN', 'OPEN_IN') and "stock_movements"."quantity" > 0)
      or ("stock_movements"."kind"::text in ('USE', 'DISCARD', 'REPACK_OUT', 'OPEN_OUT') and "stock_movements"."quantity" < 0)
      or "stock_movements"."kind"::text = 'ADJUST');--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_repack_lot" CHECK (("stock_movements"."kind"::text in ('REPACK_OUT', 'OPEN_OUT')) = ("stock_movements"."repack_lot_id" is not null));--> statement-breakpoint
ALTER TABLE "stock_products" ADD CONSTRAINT "stock_products_open_days" CHECK ("stock_products"."open_shelf_life_days" is null or "stock_products"."open_shelf_life_days" between 1 and 3650);--> statement-breakpoint
ALTER TABLE "stock_products" ADD CONSTRAINT "stock_products_medicine" CHECK ("stock_products"."is_medicine" or ("stock_products"."active_ingredient" is null and "stock_products"."strength" is null and "stock_products"."medicine_form" is null));