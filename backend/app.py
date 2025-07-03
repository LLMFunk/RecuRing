from flask import Flask, request, jsonify, g
import sqlite3
from flask_cors import CORS
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from apscheduler.schedulers.background import BackgroundScheduler
import smtplib
from email.mime.text import MIMEText
from dotenv import load_dotenv
import os
from werkzeug.security import generate_password_hash, check_password_hash
import uuid # For generating session tokens

load_dotenv() # Load environment variables from .env file

app = Flask(__name__)
CORS(app) # Enable CORS for frontend communication

DATABASE = 'tasks.db'

# In-memory store for active sessions (not persistent, for demo only)
sessions = {}

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def create_table():
    conn = get_db_connection()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT UNIQUE
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            text TEXT NOT NULL,
            completed BOOLEAN NOT NULL CHECK (completed IN (0, 1)),
            group_name TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    conn.commit()
    conn.close()

# --- Authentication Endpoints ---
@app.route('/register', methods=['POST'])
def register_user():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    email = data.get('email')

    if not username or not password or not email:
        return jsonify({'message': 'Username, password, and email are required'}), 400

    conn = get_db_connection()
    try:
        password_hash = generate_password_hash(password)
        conn.execute('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)', (username, password_hash, email))
        conn.commit()
        return jsonify({'message': 'User registered successfully'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Username or email already exists'}), 409
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login_user():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    conn.close()

    if user and check_password_hash(user['password_hash'], password):
        session_token = str(uuid.uuid4())
        sessions[session_token] = user['id'] # Store user_id with token
        return jsonify({'message': 'Login successful', 'token': session_token, 'username': user['username']}), 200
    else:
        return jsonify({'message': 'Invalid username or password'}), 401

@app.route('/logout', methods=['POST'])
def logout_user():
    token = request.headers.get('Authorization')
    if token and token in sessions:
        del sessions[token]
        return jsonify({'message': 'Logged out successfully'}), 200
    return jsonify({'message': 'Invalid token'}), 401

# --- Authentication Middleware ---
def auth_required(f):
    def wrapper(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token or token not in sessions:
            return jsonify({'message': 'Authentication required'}), 401
        g.user_id = sessions[token] # Store user_id in Flask's global context
        return f(*args, **kwargs)
    wrapper.__name__ = f.__name__ # Preserve original function name for Flask
    return wrapper

# --- Protected Task Endpoints ---
@app.route('/tasks', methods=['GET'])
@auth_required
def get_tasks():
    conn = get_db_connection()
    tasks_cursor = conn.execute('SELECT * FROM tasks WHERE user_id = ? ORDER BY group_name, id', (g.user_id,)).fetchall()
    conn.close()
    
    tasks_dict = {}
    for task in tasks_cursor:
        task_data = dict(task)
        date_str = task_data['date']
        if date_str not in tasks_dict:
            tasks_dict[date_str] = []
        tasks_dict[date_str].append(task_data)
        
    return jsonify(tasks_dict)

@app.route('/tasks', methods=['POST'])
@auth_required
def add_task():
    new_task = request.get_json()
    date_str = new_task['date']
    text = new_task['text']
    group_name = new_task.get('group_name')
    completed = new_task.get('completed', 0) # Default to 0 (False) if not provided

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('INSERT INTO tasks (user_id, date, text, completed, group_name) VALUES (?, ?, ?, ?, ?)',
                   (g.user_id, date_str, text, completed, group_name))
    new_id = cursor.lastrowid
    conn.commit()

    # Automatically add for the next month
    current_date = datetime.strptime(date_str, '%Y-%m-%d')
    next_month_date = current_date + relativedelta(months=1)
    next_month_date_str = next_month_date.strftime('%Y-%m-%d')
    cursor.execute('INSERT INTO tasks (user_id, date, text, completed, group_name) VALUES (?, ?, ?, ?, ?)',
                   (g.user_id, next_month_date_str, text, completed, group_name))
    conn.commit()
    conn.close()
    
    return jsonify({'id': new_id, 'date': date_str, 'text': text, 'completed': completed, 'group_name': group_name}), 201

@app.route('/tasks/<int:task_id>', methods=['PUT'])
@auth_required
def update_task(task_id):
    task_updates = request.get_json()
    text = task_updates.get('text')
    completed = task_updates.get('completed')

    conn = get_db_connection()
    # Ensure user can only update their own tasks
    if text is not None:
        conn.execute('UPDATE tasks SET text = ? WHERE id = ? AND user_id = ?', (text, task_id, g.user_id))
    if completed is not None:
        conn.execute('UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ?', (1 if completed else 0, task_id, g.user_id))
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Task updated successfully'})

@app.route('/tasks/<int:task_id>', methods=['DELETE'])
@auth_required
def delete_task(task_id):
    conn = get_db_connection()
    conn.execute('DELETE FROM tasks WHERE id = ? AND user_id = ?', (task_id, g.user_id))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Task deleted successfully'})

# --- Email Reminder Logic ---

def send_daily_reminders():
    today_str = datetime.now().strftime('%Y-%m-%d')
    conn = get_db_connection()
    
    # Fetch all users with their emails
    users = conn.execute('SELECT id, username, email FROM users').fetchall()

    for user in users:
        user_id = user['id']
        username = user['username']
        user_email = user['email']
        
        if not user_email:
            print(f"User {username} has no email configured. Skipping reminder.")
            continue

        # Fetch incomplete tasks for today for this specific user
        tasks_today = conn.execute(
            'SELECT text, group_name FROM tasks WHERE user_id = ? AND date = ? AND completed = 0 ORDER BY group_name, id',
            (user_id, today_str,)
        ).fetchall()

        if not tasks_today:
            print(f"No pending tasks for {username} on {today_str}. No email sent.")
            continue

        email_body = f"Hello {username},\n\nHere are your pending tasks for today ({today_str}):\n\n"
        current_group = None
        for task in tasks_today:
            if task['group_name'] and task['group_name'] != current_group:
                current_group = task['group_name']
                email_body += f"\n--- {current_group.upper()} ---\n"
            email_body += f"- {task['text']}\n"
        email_body += "\nKeep up the great work!\n\nYour RecuRing App"

        msg = MIMEText(email_body)
        msg['Subject'] = f"RecuRing: Your Daily Tasks for {today_str}"
        msg['From'] = os.getenv('EMAIL_USER')
        msg['To'] = user_email # Send to user's specific email

        try:
            with smtplib.SMTP(os.getenv('SMTP_SERVER'), int(os.getenv('SMTP_PORT'))) as server:
                server.starttls() # Secure the connection
                server.login(os.getenv('EMAIL_USER'), os.getenv('EMAIL_PASSWORD'))
                server.send_message(msg)
            print(f"Daily reminder email sent successfully for {username} on {today_str}.")
        except Exception as e:
            print(f"Failed to send email for {username}: {e}")
    conn.close()

# Schedule the daily reminder job
scheduler = BackgroundScheduler()
# Schedule to run every day at 7:00 AM (adjust hour/minute as needed)
scheduler.add_job(send_daily_reminders, 'cron', hour=7, minute=0)

# Start the scheduler when the app runs
scheduler.start()

if __name__ == '__main__':
    create_table()
    app.run(debug=True)