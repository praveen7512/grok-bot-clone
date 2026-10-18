package com.botclone.android.feature.bots

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.botclone.android.data.repository.BotRepository
import com.botclone.android.domain.model.Bot
import com.botclone.android.domain.model.BotStatus
import com.botclone.android.ui.components.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

data class BotListUiState(
    val bots: List<Bot> = emptyList(),
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class BotListViewModel @Inject constructor(private val repo: BotRepository) : ViewModel() {
    private val _state = MutableStateFlow(BotListUiState())
    val state: StateFlow<BotListUiState> = _state.asStateFlow()

    private var pollJob: Job? = null

    fun refresh(userInitiated: Boolean = false) {
        if (userInitiated) _state.update { it.copy(refreshing = true) }
        viewModelScope.launch {
            repo.list()
                .onSuccess { bots -> _state.update { it.copy(bots = bots.sortedBy { b -> b.name.lowercase() }, error = null) } }
                .onFailure { e -> _state.update { it.copy(error = e.userMessage()) } }
            _state.update { it.copy(loading = false, refreshing = false) }
            ensurePollingWhileProvisioning()
        }
    }

    fun delete(bot: Bot) {
        _state.update { s -> s.copy(bots = s.bots.filterNot { it.id == bot.id }) }
        viewModelScope.launch {
            repo.delete(bot.id).onFailure { e ->
                _state.update { it.copy(error = e.userMessage()) }
                refresh()
            }
        }
    }

    /** Containers take a few seconds to come up; poll until no bot is provisioning. */
    private fun ensurePollingWhileProvisioning() {
        if (pollJob?.isActive == true) return
        if (_state.value.bots.none { it.status == BotStatus.PROVISIONING }) return
        pollJob = viewModelScope.launch {
            while (isActive && _state.value.bots.any { it.status == BotStatus.PROVISIONING }) {
                delay(2_000)
                repo.list().onSuccess { bots -> _state.update { it.copy(bots = bots.sortedBy { b -> b.name.lowercase() }) } }
            }
        }
    }
}
