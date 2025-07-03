document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.getElementById('app-container');
    const showLoginBtn = document.getElementById('show-login');
    const showRegisterBtn = document.getElementById('show-register');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginMessage = document.getElementById('login-message');
    const registerMessage = document.getElementById('register-message');
    const loginUsernameInput = document.getElementById('login-username');
    const loginPasswordInput = document.getElementById('login-password');
    const registerUsernameInput = document.getElementById('register-username');
    const registerEmailInput = document.getElementById('register-email');
    const registerPasswordInput = document.getElementById('register-password');
    const currentUsernameSpan = document.getElementById('current-username');
    const logoutBtn = document.getElementById('logout-btn');
    const settingsBtn = document.getElementById('settings-btn');

    const calendarGrid = document.getElementById('calendar-grid');
    const currentMonthEl = document.getElementById('current-month');
    const prevMonthBtn = document.getElementById('prev-month');
    const nextMonthBtn = document.getElementById('next-month');
    const dayView = document.getElementById('day-view');
    const calendarViewBtn = document.getElementById('calendar-view-btn');
    const dayViewBtn = document.getElementById('day-view-btn');
    const monthSelector = document.querySelector('.month-selector');
    const dayViewHeaderEl = document.getElementById('day-view-current-date');
    const monthNavContainer = document.getElementById('month-nav-container');

    // State
    const API_URL = 'http://127.0.0.1:5000';
    let currentDate = new Date(); // Use current date for initial view
    let tasks = {};
    let currentView = 'calendar'; // 'calendar' or 'day'
    let authToken = localStorage.getItem('authToken');
    let currentUsername = localStorage.getItem('currentUsername');

    // --- AUTHENTICATION FUNCTIONS ---
    const showAuthScreen = () => {
        authContainer.style.display = 'flex';
        appContainer.style.display = 'none';
        loginMessage.textContent = '';
        registerMessage.textContent = '';
    };

    const showAppScreen = () => {
        authContainer.style.display = 'none';
        appContainer.style.display = 'block';
        // currentUsernameSpan.textContent = currentUsername; // Removed username display
        fetchTasks(); // Fetch tasks for the logged-in user
        feather.replace(); // Initialize Feather icons after content is loaded
    };

    const handleAuthResponse = async (response, messageEl) => {
        const data = await response.json();
        messageEl.textContent = data.message;
        if (response.ok) {
            if (data.token) {
                authToken = data.token;
                currentUsername = data.username;
                localStorage.setItem('authToken', authToken);
                localStorage.setItem('currentUsername', currentUsername);
                showAppScreen();
            }
        } else {
            messageEl.style.color = 'var(--slack-red)';
        }
    };

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = loginUsernameInput.value;
        const password = loginPasswordInput.value;
        loginMessage.textContent = 'Logging in...';
        loginMessage.style.color = 'var(--slack-text-medium)';

        try {
            const response = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            handleAuthResponse(response, loginMessage);
        } catch (error) {
            loginMessage.textContent = 'Network error. Please try again.';
            loginMessage.style.color = 'var(--slack-red)';
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = registerUsernameInput.value;
        const password = registerPasswordInput.value;
        const email = registerEmailInput.value;
        registerMessage.textContent = 'Registering...';
        registerMessage.style.color = 'var(--slack-text-medium)';

        try {
            const response = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, email }),
            });
            handleAuthResponse(response, registerMessage);
        } catch (error) {
            registerMessage.textContent = 'Network error. Please try again.';
            registerMessage.style.color = 'var(--slack-red)';
        }
    });

    logoutBtn.addEventListener('click', async () => {
        try {
            await fetch(`${API_URL}/logout`, {
                method: 'POST',
                headers: { 'Authorization': authToken },
            });
        } finally {
            authToken = null;
            currentUsername = null;
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUsername');
            showAuthScreen();
        }
    });

    showLoginBtn.addEventListener('click', () => {
        loginForm.classList.add('active');
        registerForm.classList.remove('active');
        showLoginBtn.classList.add('active');
        showRegisterBtn.classList.remove('active');
        loginMessage.textContent = '';
        registerMessage.textContent = '';
    });

    showRegisterBtn.addEventListener('click', () => {
        registerForm.classList.add('active');
        loginForm.classList.remove('active');
        showRegisterBtn.classList.add('active');
        showLoginBtn.classList.remove('active');
        loginMessage.textContent = '';
        registerMessage.textContent = '';
    });

    // --- UTILITIES ---
    const getTodayDateString = () => {
        const today = new Date();
        return formatDateToLocalISO(today);
    };

    const formatDateToLocalISO = (date) => {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // --- DATA HANDLING ---
    const fetchTasks = async () => {
        if (!authToken) {
            showAuthScreen();
            return;
        }
        try {
            const response = await fetch(`${API_URL}/tasks`, {
                headers: { 'Authorization': authToken },
            });
            if (response.status === 401) { // Unauthorized
                logoutBtn.click(); // Force logout
                return;
            }
            if (!response.ok) throw new Error('Failed to fetch tasks');
            tasks = await response.json();
            render();
        } catch (error) {
            console.error('Error fetching tasks:', error);
            calendarGrid.innerHTML = `<p style="color: red; text-align: center; grid-column: 1 / -1;">Could not connect to the backend or session expired. Please log in again.</p>`;
        }
    };

    const postNewTask = (dateString, text, groupName, completed = false) => {
        return fetch(`${API_URL}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': authToken },
            body: JSON.stringify({ date: dateString, text, group_name: groupName, completed: completed }),
        }).then(response => response.json());
    };

    const updateTask = (taskId, data) => {
        return fetch(`${API_URL}/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': authToken },
            body: JSON.stringify(data),
        });
    };

    const deleteTask = (taskId) => {
        return fetch(`${API_URL}/tasks/${taskId}`, {
            method: 'DELETE',
            headers: { 'Authorization': authToken },
        });
    };

    // --- RENDERING LOGIC ---
    const render = () => {
        const appHeader = document.querySelector('.app-header');
        if (currentView === 'calendar') {
            // Calendar View Layout
            appHeader.style.justifyContent = 'space-between';
            document.querySelector('.app-logo').style.order = 0;
            document.querySelector('.view-toggle').style.order = 0;
            monthSelector.style.display = 'flex';
            monthSelector.style.order = 0;
            dayViewHeaderEl.style.display = 'none';
            document.querySelector('.user-actions').style.order = 0;

            calendarGrid.classList.add('active');
            dayView.classList.remove('active');
            monthNavContainer.style.display = 'flex'; // Show month nav container
            renderCalendar();
        } else {
            // Day View Layout
            appHeader.style.justifyContent = 'space-between'; // Keep space-between
            document.querySelector('.app-logo').style.order = 0;
            document.querySelector('.view-toggle').style.order = 0;
            monthSelector.style.display = 'none';
            dayViewHeaderEl.style.display = 'block';
            dayViewHeaderEl.style.marginLeft = 'auto'; // Push to right
            dayViewHeaderEl.style.marginRight = '1rem'; // Space from user actions
            document.querySelector('.user-actions').style.order = 0;

            dayView.classList.add('active');
            calendarGrid.classList.remove('active');
            monthNavContainer.style.display = 'none'; // Hide month nav container
            renderDayView();
        }
    };

    const renderCalendar = () => {
        calendarGrid.innerHTML = '';
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        currentMonthEl.textContent = `${currentDate.toLocaleString('default', { month: 'long' })} ${year}`;

        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let i = 1; i <= daysInMonth; i++) {
            const dayEl = document.createElement('div');
            dayEl.classList.add('calendar-day');
            const date = new Date(year, month, i);
            const dateString = formatDateToLocalISO(date);

            if (dateString === getTodayDateString()) {
                dayEl.classList.add('current-day');
            }

            dayEl.innerHTML = `<div class="day-header">${i}</div><ul class="task-list" data-date="${dateString}"></ul>`;
            calendarGrid.appendChild(dayEl);

            const taskListEl = dayEl.querySelector('.task-list');
            renderTasksForDay(dateString, taskListEl);
        }
    };

    const renderDayView = () => {
        dayView.innerHTML = '';
        const today = new Date();
        const dateString = formatDateToLocalISO(today);
        const dayOfMonth = today.getDate().toString().padStart(2, '0');
        const monthAbbr = today.toLocaleString('default', { month: 'short' });
        const dayOfWeekAbbr = today.toLocaleString('default', { weekday: 'short' });
        dayViewHeaderEl.textContent = `${dayOfMonth} ${monthAbbr}, ${dayOfWeekAbbr}`;

        const taskListContainer = document.createElement('div');
        taskListContainer.className = 'day-view-task-container'; // New container for styling
        dayView.appendChild(taskListContainer);

        const taskListEl = document.createElement('ul');
        taskListEl.className = 'task-list';
        taskListContainer.appendChild(taskListEl);

        renderTasksForDay(dateString, taskListEl);
    };

    const renderTasksForDay = (dateString, taskListEl) => {
        taskListEl.innerHTML = '';
        const dayTasks = tasks[dateString] || [];

        // Sort tasks: incomplete first, then completed
        dayTasks.sort((a, b) => {
            const isAGroupHeader = a.text.startsWith('##');
            const isBGroupHeader = b.text.startsWith('##');

            // 1. Prioritize group headers to appear first
            if (isAGroupHeader && !isBGroupHeader) return -1;
            if (!isAGroupHeader && isBGroupHeader) return 1;

            // If both are group headers or both are regular tasks
            // 2. Sort by completion status (incomplete first)
            if (a.completed !== b.completed) {
                return a.completed ? 1 : -1;
            }

            // 3. Sort by group name (alphabetical)
            const groupCompare = (a.group_name || '').localeCompare(b.group_name || '');
            if (groupCompare !== 0) {
                return groupCompare;
            }

            // 4. Finally, sort by ID
            return a.id - b.id;
        });

        let currentGroup = null;

        dayTasks.forEach(task => {
            // If it's a group header task (starts with ##) and not a regular task
            if (task.text.startsWith('##')) {
                const groupHeader = document.createElement('h4');
                groupHeader.className = 'task-group-header';
                groupHeader.textContent = task.group_name; // Use group_name for display
                taskListEl.appendChild(groupHeader);
            } else { // Regular task
                const taskItem = createTaskElement(task, dateString);
                taskListEl.appendChild(taskItem);
            }
        });
        addCreateTaskInput(taskListEl, dateString);
    };

    const createTaskElement = (task, dateString) => {
        const li = document.createElement('li');
        li.className = 'task-item';
        li.classList.toggle('completed', task.completed);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.completed;
        checkbox.addEventListener('change', async () => {
            await updateTask(task.id, { completed: checkbox.checked });
            await fetchTasks(); // Re-fetch and re-render to ensure sorting is applied
        });

        const input = document.createElement('input');
        input.type = 'text';
        input.value = task.text;
        input.className = 'task-input';
        input.addEventListener('blur', async () => {
            const newText = input.value.trim();
            if (newText && newText !== task.text) {
                await updateTask(task.id, { text: newText });
                await fetchTasks(); // Re-fetch to update UI correctly
            } else if (!newText) {
                await deleteTask(task.id);
                await fetchTasks(); // Re-fetch to update UI correctly
            }
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

        li.appendChild(checkbox);
        li.appendChild(input);
        return li;
    };

    const addCreateTaskInput = (taskListEl, dateString) => {
        const newLi = document.createElement('li');
        newLi.className = 'task-item';
        const newInput = document.createElement('input');
        newInput.type = 'text';
        newInput.placeholder = '+ Add task or ##Group';
        newInput.className = 'task-input new-task-input';

        newInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const text = newInput.value.trim();
                if (text === '') return; // Don't add empty tasks

                let groupName = null;
                // Determine group name from the last group header in this specific taskListEl
                const groupHeadersInThisList = taskListEl.querySelectorAll('.task-group-header');
                if (groupHeadersInThisList.length > 0) {
                    groupName = groupHeadersInThisList[groupHeadersInThisList.length - 1].textContent;
                }

                if (text.startsWith('##')) {
                    groupName = text.substring(2).trim();
                    await postNewTask(dateString, text, groupName, true); // Pass true for completed
                } else {
                    await postNewTask(dateString, text, groupName, false); // Regular task, not completed
                }

                await fetchTasks(); // This re-renders everything

                // After re-render, find the new input for this specific day and focus it
                const currentDayTaskList = document.querySelector(`.task-list[data-date="${dateString}"]`);
                if (currentDayTaskList) {
                    const newFocusInput = currentDayTaskList.querySelector('.new-task-input');
                    if (newFocusInput) {
                        newFocusInput.focus();
                    }
                }
            }
        });

        newLi.appendChild(newInput);
        taskListEl.appendChild(newLi);
    };

    // --- EVENT LISTENERS ---
    prevMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        fetchTasks(); // Re-fetch and re-render for new month
    });

    nextMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        fetchTasks(); // Re-fetch and re-render for new month
    });

    calendarViewBtn.addEventListener('click', () => {
        currentView = 'calendar';
        calendarViewBtn.classList.add('active');
        dayViewBtn.classList.remove('active');
        render();
    });

    dayViewBtn.addEventListener('click', () => {
        currentView = 'day';
        dayViewBtn.classList.add('active');
        calendarViewBtn.classList.remove('active');
        render();
    });

    // --- INITIALIZATION ---
    if (authToken && currentUsername) {
        showAppScreen();
    } else {
        showAuthScreen();
    }

    // Initialize Feather icons on load
    feather.replace();
});