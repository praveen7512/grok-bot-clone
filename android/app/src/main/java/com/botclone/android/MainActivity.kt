package com.botclone.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.compose.rememberNavController
import com.botclone.android.core.datastore.AppPreferences
import com.botclone.android.core.network.SessionEvents
import com.botclone.android.data.repository.AuthRepository
import com.botclone.android.navigation.AppNavHost
import com.botclone.android.navigation.LoginRoute
import com.botclone.android.ui.theme.BotCloneTheme
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BotCloneTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    AppRoot(viewModel)
                }
            }
        }
    }
}

@Composable
private fun AppRoot(viewModel: MainViewModel) {
    val startLoggedIn by viewModel.startLoggedIn.collectAsStateWithLifecycle()
    val signedIn = startLoggedIn ?: return Box(Modifier.fillMaxSize()) // wait for DataStore's first read
    val navController = rememberNavController()

    LaunchedEffect(Unit) {
        viewModel.signedOut.collect {
            navController.navigate(LoginRoute) { popUpTo(0) { inclusive = true } }
        }
    }
    AppNavHost(navController, startLoggedIn = signedIn)
}

@HiltViewModel
class MainViewModel @Inject constructor(
    private val prefs: AppPreferences,
    sessionEvents: SessionEvents,
    auth: AuthRepository,
) : ViewModel() {
    /** Captured once so later sign-in/out changes are handled by navigation, not by re-rooting the graph. */
    private val _startLoggedIn = MutableStateFlow<Boolean?>(null)
    val startLoggedIn: StateFlow<Boolean?> = _startLoggedIn.asStateFlow()

    init {
        viewModelScope.launch { _startLoggedIn.value = prefs.settingsFlow.first().signedIn }
    }

    /** Fires when the user signs out or the backend rejects the session (401). */
    val signedOut: Flow<Unit> = prefs.settingsFlow.map { it.signedIn }
        .distinctUntilChanged()
        .drop(1)
        .filter { !it }
        .map { }

    init {
        viewModelScope.launch { sessionEvents.expired.collect { prefs.clearSession() } }
        viewModelScope.launch { auth.validateSession() }
    }
}
