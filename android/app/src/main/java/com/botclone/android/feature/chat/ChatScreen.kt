package com.botclone.android.feature.chat

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.outlined.ClearAll
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.Headset
import androidx.compose.material.icons.outlined.HeadsetOff
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.RecordVoiceOver
import androidx.compose.material.icons.automirrored.outlined.VolumeOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.botclone.android.domain.model.BotStatus
import com.botclone.android.domain.model.ChatMessage
import com.botclone.android.domain.model.Role
import com.botclone.android.ui.components.BotAvatar
import com.botclone.android.ui.components.StatusDot
import com.botclone.android.ui.components.label

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    onBack: () -> Unit,
    onOpenScreen: (botId: String, botName: String) -> Unit,
    onDeleted: () -> Unit,
    viewModel: ChatViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val speaking by viewModel.speaking.collectAsStateWithLifecycle()
    val voices by viewModel.voices.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    val listState = rememberLazyListState()

    var menuOpen by remember { mutableStateOf(false) }
    var showMemory by remember { mutableStateOf(false) }
    var showVoiceSettings by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) viewModel.startListening() else viewModel.onMicPermissionDenied()
    }
    val onMic: () -> Unit = {
        when {
            state.listening -> viewModel.stopListening()
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED ->
                viewModel.startListening()
            else -> micPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    LaunchedEffect(Unit) {
        viewModel.effects.collect { effect ->
            when (effect) {
                is ChatEffect.OpenScreen -> onOpenScreen(effect.botId, effect.botName)
                ChatEffect.Deleted -> onDeleted()
            }
        }
    }
    LaunchedEffect(state.error) {
        state.error?.let { snackbar.showSnackbar(it); viewModel.dismissError() }
    }
    // Keep the newest content in view while streaming.
    val lastLength = state.messages.lastOrNull()?.content?.length ?: 0
    LaunchedEffect(state.messages.size, lastLength) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.lastIndex)
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                title = {
                    val bot = state.bot
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        BotAvatar(bot?.name ?: "", size = 32.dp)
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(bot?.name ?: "…", maxLines = 1, overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.titleMedium)
                            if (bot != null) Row(verticalAlignment = Alignment.CenterVertically) {
                                StatusDot(bot.status)
                                Spacer(Modifier.width(4.dp))
                                Text(bot.status.label(), style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                },
                actions = {
                    if (speaking) IconButton(onClick = viewModel::stopSpeaking) {
                        Icon(Icons.AutoMirrored.Outlined.VolumeOff, contentDescription = "Stop speaking")
                    }
                    IconButton(onClick = viewModel::toggleVoiceMode) {
                        Icon(
                            if (state.voiceMode) Icons.Outlined.Headset else Icons.Outlined.HeadsetOff,
                            contentDescription = if (state.voiceMode) "Switch to typing" else "Switch to talking",
                            tint = if (state.voiceMode) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    IconButton(onClick = viewModel::requestScreen) {
                        Icon(Icons.Outlined.DesktopWindows, contentDescription = "Show bot's computer")
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "More") }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(
                                text = { Text("Memory") },
                                leadingIcon = { Icon(Icons.Outlined.Memory, null) },
                                onClick = { menuOpen = false; showMemory = true; viewModel.loadMemories() },
                            )
                            DropdownMenuItem(
                                text = { Text("Voice settings") },
                                leadingIcon = { Icon(Icons.Outlined.RecordVoiceOver, null) },
                                onClick = { menuOpen = false; showVoiceSettings = true },
                            )
                            DropdownMenuItem(
                                text = { Text("Clear chat") },
                                leadingIcon = { Icon(Icons.Outlined.ClearAll, null) },
                                onClick = { menuOpen = false; viewModel.clearChat() },
                            )
                            DropdownMenuItem(
                                text = { Text("Delete bot", color = MaterialTheme.colorScheme.error) },
                                leadingIcon = { Icon(Icons.Outlined.DeleteOutline, null, tint = MaterialTheme.colorScheme.error) },
                                onClick = { menuOpen = false; confirmDelete = true },
                            )
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            if (state.bot?.status == BotStatus.PROVISIONING) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Text("Spinning up this bot's sandbox…", style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }
            Box(Modifier.weight(1f)) {
                when {
                    state.loadingHistory -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    state.messages.isEmpty() -> Text(
                        "Say hi to ${state.bot?.name ?: "your bot"}.\nTry \"show me your computer\".",
                        modifier = Modifier.align(Alignment.Center).padding(32.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    else -> LazyColumn(
                        state = listState,
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(state.messages, key = { it.id }) { MessageBubble(it) }
                    }
                }
            }
            AnimatedVisibility(state.toolActivity != null) {
                Text(state.toolActivity.orEmpty(), style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }
            if (state.voiceMode) {
                TalkBar(
                    listening = state.listening,
                    transcript = state.transcript,
                    level = state.micLevel,
                    streaming = state.streaming,
                    enabled = viewModel.speechAvailable,
                    onMic = onMic,
                    onStop = viewModel::stopStreaming,
                )
            } else {
                TypeBar(
                    input = state.input,
                    onInput = viewModel::onInput,
                    canSend = state.canSend,
                    streaming = state.streaming,
                    listening = state.listening,
                    micEnabled = viewModel.speechAvailable,
                    onSend = { viewModel.send() },
                    onStop = viewModel::stopStreaming,
                    onMic = onMic,
                )
            }
        }
    }

    if (showMemory) {
        MemorySheet(
            items = state.memories,
            loading = state.memoriesLoading,
            onDelete = viewModel::deleteMemory,
            onDismiss = { showMemory = false },
        )
    }
    if (showVoiceSettings) state.bot?.let { bot ->
        VoiceSettingsDialog(
            initial = bot.voice,
            voices = voices,
            onPreview = viewModel::previewVoice,
            onSave = { viewModel.updateVoice(it); showVoiceSettings = false },
            onDismiss = { showVoiceSettings = false },
        )
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete ${state.bot?.name}?") },
            text = { Text("Its container, files, memory and chat history will be removed.") },
            confirmButton = {
                TextButton(onClick = { confirmDelete = false; viewModel.deleteBot() }) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun MessageBubble(message: ChatMessage) {
    val isUser = message.role == Role.USER
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start) {
        Surface(
            color = if (isUser) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
            shape = RoundedCornerShape(
                topStart = 18.dp, topEnd = 18.dp,
                bottomStart = if (isUser) 18.dp else 4.dp, bottomEnd = if (isUser) 4.dp else 18.dp,
            ),
            modifier = Modifier.widthIn(max = 320.dp),
        ) {
            Box(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                if (message.isStreaming && message.content.isEmpty()) {
                    TypingDots()
                } else {
                    SelectionContainer {
                        Text(
                            message.content + if (message.isStreaming) " ▍" else "",
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TypingDots() {
    Text("•••", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
}

@Composable
private fun TypeBar(
    input: String,
    onInput: (String) -> Unit,
    canSend: Boolean,
    streaming: Boolean,
    listening: Boolean,
    micEnabled: Boolean,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onMic: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().navigationBarsPadding().padding(8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        OutlinedTextField(
            value = input,
            onValueChange = onInput,
            placeholder = { Text(if (listening) "Listening…" else "Message") },
            maxLines = 5,
            shape = RoundedCornerShape(24.dp),
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(6.dp))
        IconButton(onClick = onMic, enabled = micEnabled) {
            Icon(Icons.Filled.Mic, contentDescription = "Voice input",
                tint = if (listening) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
        }
        if (streaming) {
            FilledIconButton(onClick = onStop) { Icon(Icons.Filled.Stop, contentDescription = "Stop") }
        } else {
            FilledIconButton(onClick = onSend, enabled = canSend) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
            }
        }
    }
}

@Composable
private fun TalkBar(
    listening: Boolean,
    transcript: String,
    level: Float,
    streaming: Boolean,
    enabled: Boolean,
    onMic: () -> Unit,
    onStop: () -> Unit,
) {
    val pulse by animateFloatAsState(if (listening) 1f + level * 0.35f else 1f, label = "micPulse")
    Column(
        Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            when {
                !enabled -> "Speech recognition isn't available on this device"
                transcript.isNotBlank() -> transcript
                listening -> "Listening…"
                streaming -> "Thinking…"
                else -> "Tap to talk"
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 3,
        )
        Spacer(Modifier.size(12.dp))
        Box(
            Modifier.size(72.dp).scale(pulse).background(
                if (listening) MaterialTheme.colorScheme.error.copy(alpha = 0.2f) else MaterialTheme.colorScheme.surfaceContainerHigh,
                CircleShape,
            ),
            contentAlignment = Alignment.Center,
        ) {
            if (streaming) {
                IconButton(onClick = onStop, modifier = Modifier.size(72.dp)) {
                    Icon(Icons.Filled.Stop, contentDescription = "Stop reply")
                }
            } else {
                IconButton(onClick = onMic, enabled = enabled, modifier = Modifier.size(72.dp)) {
                    Icon(Icons.Filled.Mic, contentDescription = if (listening) "Stop listening" else "Talk",
                        modifier = Modifier.size(32.dp),
                        tint = if (listening) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                }
            }
        }
    }
}
