<?php
/* Run from the MGS site root over SSH after configuring private/config.php:
 * php private/seed-products.php
 * Safe to rerun: product IDs are upserted, price fields are not reset if the
 * database already has an approved price.
 */
declare(strict_types=1);
$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) { fwrite(STDERR, "Missing private/config.php. Copy config.example.php first.\n"); exit(1); }
$config = require $configFile;
$db = $config['db'] ?? [];
$dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', $db['host'] ?? 'localhost', $db['name'] ?? '', $db['charset'] ?? 'utf8mb4');
try {
    $pdo = new PDO($dsn, $db['username'] ?? '', $db['password'] ?? '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]);
    $products = json_decode((string) file_get_contents(__DIR__ . '/catalog-seed.json'), true, 512, JSON_THROW_ON_ERROR);
    $sql = 'INSERT INTO products (product_id,title,category,group_name,badge,image,short_description,description,highlights_json,license_note,source_url,source_label,price_eur,price_inr,active) VALUES (:id,:title,:category,:group_name,:badge,:image,:short_description,:description,:highlights_json,:license_note,:source_url,:source_label,:price_eur,:price_inr,:active) ON DUPLICATE KEY UPDATE title=VALUES(title),category=VALUES(category),group_name=VALUES(group_name),badge=VALUES(badge),image=VALUES(image),short_description=VALUES(short_description),description=VALUES(description),highlights_json=VALUES(highlights_json),license_note=VALUES(license_note),source_url=VALUES(source_url),source_label=VALUES(source_label),active=VALUES(active)';
    $stmt = $pdo->prepare($sql);
    foreach ($products as $p) {
        $stmt->execute([
            ':id'=>$p['id'], ':title'=>$p['title'], ':category'=>$p['category'], ':group_name'=>$p['group'] ?? '', ':badge'=>$p['badge'] ?? '',
            ':image'=>$p['image'] ?? '', ':short_description'=>$p['short'] ?? '', ':description'=>$p['description'] ?? '',
            ':highlights_json'=>json_encode($p['highlights'] ?? [], JSON_UNESCAPED_UNICODE), ':license_note'=>$p['licenseNote'] ?? '',
            ':source_url'=>$p['sourceUrl'] ?? '', ':source_label'=>$p['sourceLabel'] ?? '', ':price_eur'=>$p['priceEUR'] ?? null,
            ':price_inr'=>$p['priceINR'] ?? null, ':active'=>!empty($p['active']) ? 1 : 0,
        ]);
    }
    echo count($products) . " catalogue products seeded/updated. Existing approved prices were preserved.\n";
} catch (Throwable $e) {
    fwrite(STDERR, "Seed failed: " . $e->getMessage() . "\n"); exit(1);
}
