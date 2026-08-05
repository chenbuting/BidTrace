# -*- coding: utf-8 -*-
"""SQLite 连接与建表。"""

from __future__ import annotations

import sqlite3
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = API_ROOT / "data"
DB_PATH = DATA_DIR / "bidtrace.db"


def get_conn() -> sqlite3.Connection:
    """获取数据库连接（row_factory=Row）。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """初始化全部表。"""
    conn = get_conn()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'member',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS user_permission_overrides (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                permission_code TEXT NOT NULL,
                granted INTEGER NOT NULL,
                UNIQUE(user_id, permission_code),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS platforms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL DEFAULT '',
                login_method TEXT NOT NULL DEFAULT '',
                login_account TEXT NOT NULL DEFAULT '',
                login_password TEXT NOT NULL DEFAULT '',
                has_ca TEXT NOT NULL DEFAULT '否',
                ca_password TEXT NOT NULL DEFAULT '',
                priority TEXT NOT NULL DEFAULT '中',
                status TEXT NOT NULL DEFAULT '启用',
                weight REAL NOT NULL DEFAULT 0,
                remark TEXT NOT NULL DEFAULT '',
                created_by INTEGER,
                updated_by INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_platforms_name ON platforms(name);
            CREATE INDEX IF NOT EXISTS idx_platforms_status ON platforms(status);

            CREATE TABLE IF NOT EXISTS inquiries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                register_date TEXT NOT NULL DEFAULT '',
                platform_name TEXT NOT NULL DEFAULT '',
                project_name TEXT NOT NULL DEFAULT '',
                is_bid TEXT NOT NULL DEFAULT '否',
                is_registered TEXT NOT NULL DEFAULT '否',
                file_received TEXT NOT NULL DEFAULT '否',
                is_paid TEXT NOT NULL DEFAULT '否',
                overview_done TEXT NOT NULL DEFAULT '否',
                skip_reason_category TEXT NOT NULL DEFAULT '',
                skip_reason_detail TEXT NOT NULL DEFAULT '',
                deadline TEXT NOT NULL DEFAULT '',
                created_by INTEGER,
                updated_by INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_inquiries_date ON inquiries(register_date);
            CREATE INDEX IF NOT EXISTS idx_inquiries_platform ON inquiries(platform_name);
            CREATE INDEX IF NOT EXISTS idx_inquiries_created_by ON inquiries(created_by);

            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                username TEXT NOT NULL DEFAULT '',
                action TEXT NOT NULL DEFAULT '',
                target TEXT NOT NULL DEFAULT '',
                detail TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS platform_backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reason TEXT NOT NULL DEFAULT '',
                row_count INTEGER NOT NULL DEFAULT 0,
                payload TEXT NOT NULL DEFAULT '[]',
                created_by INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS bid_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                serial_no TEXT NOT NULL DEFAULT '',
                open_time TEXT NOT NULL DEFAULT '',
                bidder TEXT NOT NULL DEFAULT '',
                project_name TEXT NOT NULL DEFAULT '',
                platform TEXT NOT NULL DEFAULT '',
                remark TEXT NOT NULL DEFAULT '',
                is_won TEXT NOT NULL DEFAULT '',
                win_amount TEXT NOT NULL DEFAULT '',
                is_void TEXT NOT NULL DEFAULT '',
                bid_amount TEXT NOT NULL DEFAULT '',
                payment_method TEXT NOT NULL DEFAULT '',
                created_by INTEGER,
                updated_by INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_bid_projects_open ON bid_projects(open_time);
            CREATE INDEX IF NOT EXISTS idx_bid_projects_name ON bid_projects(project_name);

            CREATE TABLE IF NOT EXISTS bid_deposits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                serial_no TEXT NOT NULL DEFAULT '',
                apply_time TEXT NOT NULL DEFAULT '',
                project_name TEXT NOT NULL DEFAULT '',
                payee TEXT NOT NULL DEFAULT '',
                platform TEXT NOT NULL DEFAULT '',
                amount TEXT NOT NULL DEFAULT '',
                bidder TEXT NOT NULL DEFAULT '',
                is_returned TEXT NOT NULL DEFAULT '',
                return_contact TEXT NOT NULL DEFAULT '',
                remark TEXT NOT NULL DEFAULT '',
                created_by INTEGER,
                updated_by INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_bid_deposits_apply ON bid_deposits(apply_time);
            CREATE INDEX IF NOT EXISTS idx_bid_deposits_name ON bid_deposits(project_name);

            CREATE TABLE IF NOT EXISTS bid_project_backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reason TEXT NOT NULL DEFAULT '',
                row_count INTEGER NOT NULL DEFAULT 0,
                payload TEXT NOT NULL DEFAULT '[]',
                created_by INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS bid_deposit_backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reason TEXT NOT NULL DEFAULT '',
                row_count INTEGER NOT NULL DEFAULT 0,
                payload TEXT NOT NULL DEFAULT '[]',
                created_by INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS inquiry_backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reason TEXT NOT NULL DEFAULT '',
                row_count INTEGER NOT NULL DEFAULT 0,
                payload TEXT NOT NULL DEFAULT '[]',
                created_by INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            -- 可配置角色：权限包存在 role_permissions，用户挂 roles.code
            CREATE TABLE IF NOT EXISTS roles (
                code TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                is_system INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS role_permissions (
                role_code TEXT NOT NULL,
                permission_code TEXT NOT NULL,
                PRIMARY KEY (role_code, permission_code),
                FOREIGN KEY(role_code) REFERENCES roles(code) ON DELETE CASCADE
            );

            -- 站内通知：一条通知 + 多接收人
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER,
                sender_username TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS notification_recipients (
                notification_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                read_at TEXT,
                PRIMARY KEY (notification_id, user_id),
                FOREIGN KEY(notification_id) REFERENCES notifications(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_notify_recipients_user
              ON notification_recipients(user_id, read_at);
            """
        )
        conn.commit()
    finally:
        conn.close()

    # 种子角色（仅首次写入，不覆盖已配置权限）
    from . import queries as _q

    _q.ensure_seed_roles()
