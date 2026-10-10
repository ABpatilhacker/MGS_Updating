<?php
/* Run over SSH with: php private/create-admin.php admin@example.com "Full Name"
 * The password is prompted interactively or supplied via MGS_ADMIN_PASSWORD.
 * This file refuses to run through a web request.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) { fwrite(STDERR, "Missing private/config.php.\n"); exit(1); }
$email = strtolower(trim($argv[1] ?? ''));
$name = trim($argv[2] ?? 'MGS Administrator');
$password = getenv('MGS_ADMIN_PASSWORD') ?: '';
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { fwrite(STDERR, "Usage: php private/create-admin.php admin@example.com \"Full Name\"\n"); exit(1); }
if ($password === '' && function_exists('readline')) { $password = (string) readline('Choose admin password (12+ characters): '); }
if (strlen($password) < 12) { fwrite(STDERR, "Admin password must be at least 12 characters. Set MGS_ADMIN_PASSWORD or use interactive mode.\n"); exit(1); }
$config = require $configFile; $db = $config['db'] ?? [];
$dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', $db['host'] ?? 'localhost', $db['name'] ?? '', $db['charset'] ?? 'utf8mb4');
try {
    $pdo = new PDO($dsn, $db['username'] ?? '', $db['password'] ?? '', [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES=>false]);
    $stmt = $pdo->prepare("INSERT INTO users (full_name,email,password_hash,role) VALUES (:name,:email,:hash,'admin') ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),password_hash=VALUES(password_hash),role='admin'");
    $stmt->execute([':name'=>$name, ':email'=>$email, ':hash'=>password_hash($password, PASSWORD_DEFAULT)]);
    echo "Admin account created/updated for {$email}. Keep the credentials private.\n";
} catch (Throwable $e) { fwrite(STDERR, "Admin creation failed: " . $e->getMessage() . "\n"); exit(1); }
