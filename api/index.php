<?php
/*
 * MGS same-origin JSON API for PHP/MySQL shared hosting.
 *
 * Actions: bootstrap, products, site-settings, me, signup, login, logout,
 * checkout, my-orders, admin-products, admin-product-save, admin-orders,
 * admin-order-status, admin-customers, admin-settings-save.
 *
 * No card details are accepted here. Checkout creates an enquiry/order record;
 * connect a supported hosted payment provider before taking money.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
error_reporting(E_ALL);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, private');
header('Referrer-Policy: same-origin');

$isHttps = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && strtolower((string)$_SERVER['HTTPS']) !== 'off';
session_name('MGSSESSID');
session_set_cookie_params([
    'lifetime' => 0, 'path' => '/', 'secure' => $isHttps,
    'httponly' => true, 'samesite' => 'Lax'
]);
session_start();
if (empty($_SESSION['mgs_csrf'])) $_SESSION['mgs_csrf'] = bin2hex(random_bytes(32));

function respond(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(string $message, int $status = 400): never { respond(['ok' => false, 'error' => $message], $status); }
function bodyJson(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) fail('Invalid JSON request body.', 400);
    return $data;
}
function currentUser(): ?array {
    if (empty($_SESSION['mgs_user'])) return null;
    return $_SESSION['mgs_user'];
}
function requireLogin(): array {
    $user = currentUser();
    if (!$user) fail('Please sign in to continue.', 401);
    return $user;
}
function requireAdmin(): array {
    $user = requireLogin();
    if (($user['role'] ?? '') !== 'admin') fail('Administrator access is required.', 403);
    return $user;
}
function checkCsrf(): void {
    $received = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if ($received === '' || !hash_equals((string)($_SESSION['mgs_csrf'] ?? ''), $received)) {
        fail('Security token expired. Refresh the page and try again.', 419);
    }
}
function cleanString(mixed $value, int $max = 2000): string {
    $value = trim((string)($value ?? ''));
    if (strlen($value) > $max) $value = substr($value, 0, $max);
    return $value;
}
function optionalPrice(mixed $value): ?string {
    if ($value === null || trim((string)$value) === '') return null;
    if (!is_numeric($value) || (float)$value < 0 || (float)$value > 999999999) fail('Price must be a non-negative number.', 422);
    return number_format((float)$value, 2, '.', '');
}
function productToApi(array $row): array {
    return [
        'id' => $row['product_id'], 'title' => $row['title'], 'category' => $row['category'],
        'group' => $row['group_name'], 'badge' => $row['badge'], 'image' => $row['image'],
        'short' => $row['short_description'], 'description' => $row['description'],
        'highlights' => json_decode((string)($row['highlights_json'] ?? '[]'), true) ?: [],
        'licenseNote' => $row['license_note'] ?? '', 'sourceUrl' => $row['source_url'] ?? '',
        'sourceLabel' => $row['source_label'] ?? '',
        'priceEUR' => $row['price_eur'] === null ? null : (float)$row['price_eur'],
        'priceINR' => $row['price_inr'] === null ? null : (float)$row['price_inr'],
        'active' => (bool)$row['active']
    ];
}
function loadProduct(PDO $pdo, string $id, bool $onlyActive = true): ?array {
    $sql = 'SELECT * FROM products WHERE product_id = :id' . ($onlyActive ? ' AND active = 1' : '') . ' LIMIT 1';
    $stmt = $pdo->prepare($sql); $stmt->execute([':id' => $id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ? $row : null;
}
function getSiteSettings(PDO $pdo, array $config): array {
    $defaults = [
        'brandName' => $config['business_name'] ?? 'Mercury Global Systems',
        'brandLogoPath' => 'assets/images/mgs-logo.svg',
        'supportEmail' => $config['support_email'] ?? 'info@mercuryglobalsystems.com',
        'footerTagline' => 'Enterprise technology built for the real world.',
        'defaultCurrency' => 'EUR',
        'shopIntro' => 'Compare Microsoft licence options and storage capacities. Select a product to review details.',
        'heroTitle' => 'Enterprise Infrastructure & Global Tech Ventures.',
        'heroSubtitle' => 'A sharp, practical platform for European market access, resilient IT infrastructure, and critical data recovery.',
        'heroImageUrl' => 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?q=85&w=1600'
    ];
    $stmt = $pdo->query('SELECT setting_key, setting_value FROM site_settings');
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $value = json_decode((string)$row['setting_value'], true);
        if (array_key_exists($row['setting_key'], $defaults)) $defaults[$row['setting_key']] = is_string($value) ? $value : (string)$value;
    }
    return $defaults;
}
function storeOrderView(PDO $pdo, array $orderRow): array {
    $itemsStmt = $pdo->prepare('SELECT product_id, product_title, quantity, unit_price_eur, unit_price_inr FROM order_items WHERE order_id = :id ORDER BY id');
    $itemsStmt->execute([':id' => $orderRow['id']]);
    $items = [];
    foreach ($itemsStmt->fetchAll(PDO::FETCH_ASSOC) as $item) {
        $currency = $orderRow['currency'];
        $price = $currency === 'INR' ? $item['unit_price_inr'] : $item['unit_price_eur'];
        $priceLabel = $price === null ? 'Price on request' : number_format((float)$price, 2) . ' ' . $currency;
        $items[] = [
            'id' => $item['product_id'], 'title' => $item['product_title'], 'quantity' => (int)$item['quantity'],
            'priceEUR' => $item['unit_price_eur'] === null ? null : (float)$item['unit_price_eur'],
            'priceINR' => $item['unit_price_inr'] === null ? null : (float)$item['unit_price_inr'],
            'priceLabel' => $priceLabel
        ];
    }
    return [
        'id' => $orderRow['order_code'], 'date' => date(DATE_ATOM, strtotime($orderRow['created_at'])),
        'status' => $orderRow['status'], 'currency' => $orderRow['currency'], 'items' => $items,
        'subtotal' => $orderRow['subtotal_amount'] === null ? null : (float)$orderRow['subtotal_amount'],
        'subtotalLabel' => $orderRow['subtotal_label'],
        'customer' => [
            'name' => $orderRow['customer_name'], 'email' => $orderRow['customer_email'],
            'company' => $orderRow['company'], 'phone' => $orderRow['phone'], 'address' => $orderRow['address'],
            'paymentPreference' => $orderRow['payment_preference'], 'notes' => $orderRow['notes']
        ]
    ];
}

$action = cleanString($_GET['action'] ?? 'bootstrap', 80);
$configFile = dirname(__DIR__) . '/private/config.php';
if (!is_file($configFile)) {
    if ($action === 'bootstrap') respond(['ok' => true, 'backendReady' => false, 'csrfToken' => $_SESSION['mgs_csrf'], 'user' => currentUser()]);
    fail('MGS backend is not configured yet. Copy private/config.example.php to private/config.php and configure the database.', 503);
}
$config = require $configFile;
$db = $config['db'] ?? [];
try {
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', $db['host'] ?? 'localhost', $db['name'] ?? '', $db['charset'] ?? 'utf8mb4');
    $pdo = new PDO($dsn, $db['username'] ?? '', $db['password'] ?? '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false
    ]);
} catch (Throwable $e) {
    error_log('[MGS API] Database connection failed: ' . $e->getMessage());
    if ($action === 'bootstrap') respond(['ok' => true, 'backendReady' => false, 'csrfToken' => $_SESSION['mgs_csrf'], 'user' => currentUser()]);
    fail('MGS backend database is unavailable. Check the server configuration.', 503);
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method === 'POST') checkCsrf();
$user = currentUser();

try {
    if ($action === 'bootstrap' && $method === 'GET') {
        respond(['ok' => true, 'backendReady' => true, 'csrfToken' => $_SESSION['mgs_csrf'], 'user' => $user]);
    }

    if ($action === 'products' && $method === 'GET') {
        $stmt = $pdo->query('SELECT * FROM products WHERE active = 1 ORDER BY category, title');
        respond(['ok' => true, 'products' => array_map('productToApi', $stmt->fetchAll())]);
    }

    if ($action === 'site-settings' && $method === 'GET') {
        respond(['ok' => true, 'settings' => getSiteSettings($pdo, $config)]);
    }

    if ($action === 'me' && $method === 'GET') {
        respond(['ok' => true, 'user' => $user]);
    }

    if ($action === 'signup' && $method === 'POST') {
        $data = bodyJson();
        $name = cleanString($data['name'] ?? '', 160);
        $email = strtolower(cleanString($data['email'] ?? '', 254));
        $password = (string)($data['password'] ?? '');
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid name and email address.', 422);
        if (strlen($password) < 12) fail('Use a password with at least 12 characters.', 422);
        $stmt = $pdo->prepare('INSERT INTO users (full_name,email,password_hash,role) VALUES (:name,:email,:hash,\'customer\')');
        try { $stmt->execute([':name' => $name, ':email' => $email, ':hash' => password_hash($password, PASSWORD_DEFAULT)]); }
        catch (PDOException $e) { if ((string)$e->getCode() === '23000') fail('An account for this email already exists. Sign in instead.', 409); throw $e; }
        session_regenerate_id(true);
        $_SESSION['mgs_user'] = ['id' => (int)$pdo->lastInsertId(), 'name' => $name, 'email' => $email, 'role' => 'customer'];
        $_SESSION['mgs_csrf'] = bin2hex(random_bytes(32));
        respond(['ok' => true, 'user' => $_SESSION['mgs_user'], 'csrfToken' => $_SESSION['mgs_csrf']], 201);
    }

    if ($action === 'login' && $method === 'POST') {
        $data = bodyJson();
        $email = strtolower(cleanString($data['email'] ?? '', 254));
        $password = (string)($data['password'] ?? '');
        $attempts = $_SESSION['mgs_login_attempts'] ?? ['count' => 0, 'since' => time()];
        if (time() - (int)$attempts['since'] > 900) $attempts = ['count' => 0, 'since' => time()];
        if ((int)$attempts['count'] >= 10) fail('Too many sign-in attempts. Wait 15 minutes and try again.', 429);
        $stmt = $pdo->prepare('SELECT id,full_name,email,password_hash,role FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $email]); $record = $stmt->fetch();
        if (!$record || !password_verify($password, $record['password_hash'])) {
            $attempts['count'] = (int)$attempts['count'] + 1; $_SESSION['mgs_login_attempts'] = $attempts;
            fail('Email or password is incorrect.', 401);
        }
        unset($_SESSION['mgs_login_attempts']); session_regenerate_id(true);
        $_SESSION['mgs_user'] = ['id' => (int)$record['id'], 'name' => $record['full_name'], 'email' => $record['email'], 'role' => $record['role']];
        $_SESSION['mgs_csrf'] = bin2hex(random_bytes(32));
        respond(['ok' => true, 'user' => $_SESSION['mgs_user'], 'csrfToken' => $_SESSION['mgs_csrf']]);
    }

    if ($action === 'logout' && $method === 'POST') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', ['expires' => time() - 42000, 'path' => $params['path'], 'secure' => $params['secure'], 'httponly' => true, 'samesite' => 'Lax']);
        }
        session_destroy(); respond(['ok' => true]);
    }

    if ($action === 'checkout' && $method === 'POST') {
        $data = bodyJson(); $customer = is_array($data['customer'] ?? null) ? $data['customer'] : [];
        $name = cleanString($customer['name'] ?? '', 160); $email = strtolower(cleanString($customer['email'] ?? '', 254));
        $address = cleanString($customer['address'] ?? '', 3000); $currency = strtoupper(cleanString($data['currency'] ?? 'EUR', 3));
        $items = is_array($data['items'] ?? null) ? $data['items'] : [];
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || $address === '') fail('Enter your name, a valid email and address/country.', 422);
        if (!in_array($currency, ['EUR', 'INR'], true)) fail('Unsupported display currency.', 422);
        if (!$items || count($items) > 80) fail('Your basket is empty or contains too many different items.', 422);
        $resolved = []; $sum = 0.0; $missing = false;
        foreach ($items as $item) {
            $id = cleanString($item['id'] ?? '', 100); $quantity = filter_var($item['quantity'] ?? 1, FILTER_VALIDATE_INT);
            if ($id === '' || $quantity === false || $quantity < 1 || $quantity > 99) fail('Invalid product or quantity in basket.', 422);
            $product = loadProduct($pdo, $id, true); if (!$product) fail('One item in your basket is no longer available. Refresh the shop and try again.', 409);
            $unit = $currency === 'INR' ? $product['price_inr'] : $product['price_eur'];
            if ($unit === null) $missing = true; else $sum += (float)$unit * $quantity;
            $resolved[] = ['product' => $product, 'quantity' => $quantity];
        }
        $orderCode = 'MGS-' . gmdate('Ymd') . '-' . strtoupper(bin2hex(random_bytes(3)));
        $subtotalLabel = $missing ? 'Price on request / quote required' : number_format($sum, 2) . ' ' . $currency;
        $pdo->beginTransaction();
        $insertOrder = $pdo->prepare('INSERT INTO orders (order_code,user_id,customer_name,customer_email,company,phone,address,payment_preference,notes,currency,subtotal_amount,subtotal_label,status) VALUES (:code,:user_id,:name,:email,:company,:phone,:address,:payment,:notes,:currency,:subtotal,:label,\'Enquiry received\')');
        $insertOrder->execute([
            ':code' => $orderCode, ':user_id' => $user['id'] ?? null, ':name' => $name, ':email' => $email,
            ':company' => cleanString($customer['company'] ?? '', 200) ?: null, ':phone' => cleanString($customer['phone'] ?? '', 80) ?: null,
            ':address' => $address, ':payment' => cleanString($customer['paymentPreference'] ?? '', 120) ?: null,
            ':notes' => cleanString($customer['notes'] ?? '', 4000) ?: null, ':currency' => $currency,
            ':subtotal' => $missing ? null : number_format($sum, 2, '.', ''), ':label' => $subtotalLabel
        ]);
        $orderId = (int)$pdo->lastInsertId();
        $insertItem = $pdo->prepare('INSERT INTO order_items (order_id,product_id,product_title,quantity,unit_price_eur,unit_price_inr) VALUES (:order_id,:product_id,:title,:quantity,:eur,:inr)');
        foreach ($resolved as $line) {
            $pr = $line['product'];
            $insertItem->execute([':order_id' => $orderId, ':product_id' => $pr['product_id'], ':title' => $pr['title'], ':quantity' => $line['quantity'], ':eur' => $pr['price_eur'], ':inr' => $pr['price_inr']]);
        }
        $pdo->commit();
        respond(['ok' => true, 'orderCode' => $orderCode, 'status' => 'Enquiry received', 'subtotalLabel' => $subtotalLabel, 'message' => 'Your enquiry is saved on the MGS server. No payment was taken.']);
    }

    if ($action === 'my-orders' && $method === 'GET') {
        $user = requireLogin();
        $stmt = $pdo->prepare('SELECT * FROM orders WHERE user_id = :user_id ORDER BY created_at DESC, id DESC');
        $stmt->execute([':user_id' => $user['id']]);
        respond(['ok' => true, 'orders' => array_map(fn($row) => storeOrderView($pdo, $row), $stmt->fetchAll())]);
    }

    if ($action === 'admin-products' && $method === 'GET') {
        requireAdmin(); $stmt = $pdo->query('SELECT * FROM products ORDER BY category, title');
        respond(['ok' => true, 'products' => array_map('productToApi', $stmt->fetchAll())]);
    }

    if ($action === 'admin-product-save' && $method === 'POST') {
        requireAdmin(); $d = bodyJson();
        $id = cleanString($d['id'] ?? '', 100); $title = cleanString($d['title'] ?? '', 240);
        $category = cleanString($d['category'] ?? 'software', 30);
        if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,99}$/', $id)) fail('Product ID contains invalid characters.', 422);
        if ($title === '' || !in_array($category, ['software','storage'], true)) fail('Enter a product title and choose a valid category.', 422);
        $highlights = $d['highlights'] ?? []; if (!is_array($highlights)) $highlights = [];
        $highlights = array_values(array_slice(array_map(fn($v) => cleanString($v, 500), $highlights), 0, 20));
        $sourceUrl = cleanString($d['sourceUrl'] ?? '', 1000);
        if ($sourceUrl !== '' && !filter_var($sourceUrl, FILTER_VALIDATE_URL)) fail('Reference URL must be a full URL.', 422);
        $stmt = $pdo->prepare('INSERT INTO products (product_id,title,category,group_name,badge,image,short_description,description,highlights_json,license_note,source_url,source_label,price_eur,price_inr,active) VALUES (:id,:title,:category,:group_name,:badge,:image,:short,:description,:highlights,:note,:source_url,:source_label,:eur,:inr,:active) ON DUPLICATE KEY UPDATE title=VALUES(title),category=VALUES(category),group_name=VALUES(group_name),badge=VALUES(badge),image=VALUES(image),short_description=VALUES(short_description),description=VALUES(description),highlights_json=VALUES(highlights_json),license_note=VALUES(license_note),source_url=VALUES(source_url),source_label=VALUES(source_label),price_eur=VALUES(price_eur),price_inr=VALUES(price_inr),active=VALUES(active)');
        $stmt->execute([
            ':id'=>$id, ':title'=>$title, ':category'=>$category, ':group_name'=>cleanString($d['group'] ?? '',120), ':badge'=>cleanString($d['badge'] ?? '',100),
            ':image'=>cleanString($d['image'] ?? '',1000), ':short'=>cleanString($d['short'] ?? '',600), ':description'=>cleanString($d['description'] ?? '',12000),
            ':highlights'=>json_encode($highlights, JSON_UNESCAPED_UNICODE), ':note'=>cleanString($d['licenseNote'] ?? '',4000),
            ':source_url'=>$sourceUrl ?: null, ':source_label'=>cleanString($d['sourceLabel'] ?? '',240) ?: null,
            ':eur'=>optionalPrice($d['priceEUR'] ?? null), ':inr'=>optionalPrice($d['priceINR'] ?? null), ':active'=>!empty($d['active']) ? 1 : 0
        ]);
        $row = loadProduct($pdo, $id, false);
        respond(['ok'=>true,'product'=>productToApi($row)]);
    }

    if ($action === 'admin-orders' && $method === 'GET') {
        requireAdmin(); $stmt = $pdo->query('SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 500');
        respond(['ok'=>true,'orders'=>array_map(fn($row) => storeOrderView($pdo, $row), $stmt->fetchAll())]);
    }

    if ($action === 'admin-order-status' && $method === 'POST') {
        requireAdmin(); $d = bodyJson(); $id = cleanString($d['id'] ?? '', 48); $status = cleanString($d['status'] ?? '', 60);
        $allowed = ['Enquiry received','Under review','Quote prepared','Closed','Cancelled'];
        if (!in_array($status, $allowed, true)) fail('Choose a valid enquiry status.', 422);
        $stmt = $pdo->prepare('UPDATE orders SET status = :status WHERE order_code = :code'); $stmt->execute([':status'=>$status, ':code'=>$id]);
        if ($stmt->rowCount() < 1) { $check = $pdo->prepare('SELECT id FROM orders WHERE order_code = :code'); $check->execute([':code'=>$id]); if (!$check->fetch()) fail('Enquiry not found.', 404); }
        respond(['ok'=>true]);
    }

    if ($action === 'admin-customers' && $method === 'GET') {
        requireAdmin(); $stmt = $pdo->query('SELECT id,full_name,email,role,created_at FROM users ORDER BY created_at DESC LIMIT 500');
        $customers = array_map(fn($row) => ['id'=>(int)$row['id'],'name'=>$row['full_name'],'email'=>$row['email'],'role'=>$row['role'],'createdAt'=>date(DATE_ATOM,strtotime($row['created_at']))], $stmt->fetchAll());
        respond(['ok'=>true,'customers'=>$customers]);
    }

    if ($action === 'admin-settings-save' && $method === 'POST') {
        requireAdmin(); $d = bodyJson();
        $allowed = ['brandName','brandLogoPath','supportEmail','footerTagline','defaultCurrency','shopIntro','heroTitle','heroSubtitle','heroImageUrl'];
        if (!isset($d['supportEmail']) || !filter_var((string)$d['supportEmail'], FILTER_VALIDATE_EMAIL)) fail('Enter a valid support email.', 422);
        if (!in_array((string)($d['defaultCurrency'] ?? 'EUR'), ['EUR','INR'], true)) fail('Unsupported default currency.', 422);
        if (!empty($d['heroImageUrl']) && !filter_var((string)$d['heroImageUrl'], FILTER_VALIDATE_URL)) fail('Hero image must be a full URL.', 422);
        $stmt = $pdo->prepare('INSERT INTO site_settings (setting_key,setting_value) VALUES (:key,:value) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)');
        foreach ($allowed as $key) { if (array_key_exists($key, $d)) $stmt->execute([':key'=>$key, ':value'=>json_encode(cleanString($d[$key], 1200), JSON_UNESCAPED_UNICODE)]); }
        respond(['ok'=>true,'settings'=>getSiteSettings($pdo,$config)]);
    }

    fail('Unknown API action or unsupported HTTP method.', 404);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('[MGS API] Request failed (' . $action . '): ' . $e->getMessage());
    fail('The MGS server could not complete this request. Check the server logs or contact the administrator.', 500);
}
