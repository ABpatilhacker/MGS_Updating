-- MGS MySQL schema (InnoDB, utf8mb4). Run once in the MGS database.
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer','admin') NOT NULL DEFAULT 'customer',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  product_id VARCHAR(100) NOT NULL,
  title VARCHAR(240) NOT NULL,
  category VARCHAR(30) NOT NULL DEFAULT 'software',
  group_name VARCHAR(120) NOT NULL DEFAULT '',
  badge VARCHAR(100) NOT NULL DEFAULT '',
  image VARCHAR(1000) NOT NULL DEFAULT '',
  short_description VARCHAR(600) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  highlights_json JSON NULL,
  license_note TEXT NULL,
  source_url VARCHAR(1000) NULL,
  source_label VARCHAR(240) NULL,
  price_eur DECIMAL(12,2) NULL,
  price_inr DECIMAL(12,2) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id), KEY idx_products_active (active), KEY idx_products_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_code VARCHAR(48) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(160) NOT NULL,
  customer_email VARCHAR(254) NOT NULL,
  company VARCHAR(200) NULL,
  phone VARCHAR(80) NULL,
  address TEXT NOT NULL,
  payment_preference VARCHAR(120) NULL,
  notes TEXT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  subtotal_amount DECIMAL(12,2) NULL,
  subtotal_label VARCHAR(160) NOT NULL,
  status VARCHAR(60) NOT NULL DEFAULT 'Enquiry received',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uq_orders_code (order_code), KEY idx_orders_email (customer_email), KEY idx_orders_status (status),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id VARCHAR(100) NOT NULL,
  product_title VARCHAR(240) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_eur DECIMAL(12,2) NULL,
  unit_price_inr DECIMAL(12,2) NULL,
  PRIMARY KEY (id), KEY idx_order_items_order (order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_settings (
  setting_key VARCHAR(120) NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
