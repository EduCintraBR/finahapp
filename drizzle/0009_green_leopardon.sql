CREATE TYPE "public"."stock_lot_origin" AS ENUM('PURCHASE', 'REPACK');--> statement-breakpoint
CREATE TYPE "public"."stock_measure" AS ENUM('UNIT', 'WEIGHT', 'VOLUME');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_kind" AS ENUM('IN', 'USE', 'DISCARD', 'ADJUST', 'REPACK_OUT', 'REPACK_IN');--> statement-breakpoint
CREATE TABLE "stock_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"parent_id" uuid,
	"icon" varchar(40),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_categories_parent_name" UNIQUE NULLS NOT DISTINCT("parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "stock_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"location_id" uuid,
	"package_name" varchar(40) NOT NULL,
	"content_per_package" bigint,
	"entry_date" date NOT NULL,
	"expiry_date" date,
	"origin" "stock_lot_origin" DEFAULT 'PURCHASE' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_lots_product_number" UNIQUE("product_id","number"),
	CONSTRAINT "stock_lots_number" CHECK ("stock_lots"."number" > 0),
	CONSTRAINT "stock_lots_content" CHECK ("stock_lots"."content_per_package" is null or "stock_lots"."content_per_package" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"kind" "stock_movement_kind" NOT NULL,
	"quantity" integer NOT NULL,
	"movement_date" date NOT NULL,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	CONSTRAINT "stock_movements_nonzero" CHECK ("stock_movements"."quantity" <> 0),
	CONSTRAINT "stock_movements_direction" CHECK (("stock_movements"."kind" in ('IN', 'REPACK_IN') and "stock_movements"."quantity" > 0)
      or ("stock_movements"."kind" in ('USE', 'DISCARD', 'REPACK_OUT') and "stock_movements"."quantity" < 0)
      or "stock_movements"."kind" = 'ADJUST')
);
--> statement-breakpoint
CREATE TABLE "stock_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"category_id" uuid NOT NULL,
	"default_location_id" uuid,
	"measure" "stock_measure" NOT NULL,
	"prefix" varchar(4) NOT NULL,
	"min_quantity" bigint,
	"target_quantity" bigint,
	"default_package" varchar(40),
	"default_content" bigint,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_products_prefix_unique" UNIQUE("prefix"),
	CONSTRAINT "stock_products_prefix" CHECK ("stock_products"."prefix" ~ '^[A-Z0-9]{2,4}$'),
	CONSTRAINT "stock_products_min" CHECK ("stock_products"."min_quantity" is null or "stock_products"."min_quantity" > 0),
	CONSTRAINT "stock_products_target" CHECK ("stock_products"."target_quantity" is null or "stock_products"."target_quantity" > 0),
	CONSTRAINT "stock_products_target_min" CHECK ("stock_products"."min_quantity" is null or "stock_products"."target_quantity" is null or "stock_products"."target_quantity" >= "stock_products"."min_quantity"),
	CONSTRAINT "stock_products_content" CHECK ("stock_products"."default_content" is null or "stock_products"."default_content" > 0)
);
--> statement-breakpoint
ALTER TABLE "stock_categories" ADD CONSTRAINT "stock_categories_parent_id_stock_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."stock_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_product_id_stock_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."stock_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_location_id_stock_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_products" ADD CONSTRAINT "stock_products_category_id_stock_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."stock_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_products" ADD CONSTRAINT "stock_products_default_location_id_stock_locations_id_fk" FOREIGN KEY ("default_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_products" ADD CONSTRAINT "stock_products_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_lot" ON "stock_movements" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "stock_products_category" ON "stock_products" USING btree ("category_id");