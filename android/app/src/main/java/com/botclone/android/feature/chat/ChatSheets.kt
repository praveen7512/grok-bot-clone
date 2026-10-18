package com.botclone.android.feature.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.botclone.android.core.voice.VoiceOption
import com.botclone.android.domain.model.MemoryItem
import com.botclone.android.domain.model.VoiceSettings
import com.botclone.android.feature.voice.VoiceSettingsEditor

/** Shows what this bot has saved to its own persistent memory. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MemorySheet(
    items: List<MemoryItem>?,
    loading: Boolean,
    onDelete: (MemoryItem) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
            Text("Memory", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 16.dp))
            Text(
                "Facts this bot saved for itself. Only this bot can see them.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
            when {
                loading && items == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                items.isNullOrEmpty() -> Text(
                    "Nothing saved yet. Tell the bot \"remember that…\".",
                    modifier = Modifier.padding(16.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                else -> LazyColumn(Modifier.heightIn(max = 480.dp)) {
                    items(items, key = { it.key }) { item ->
                        ListItem(
                            headlineContent = { Text(item.key, style = MaterialTheme.typography.labelLarge) },
                            supportingContent = { Text(item.value) },
                            trailingContent = {
                                IconButton(onClick = { onDelete(item) }) {
                                    Icon(Icons.Outlined.DeleteOutline, contentDescription = "Forget ${item.key}")
                                }
                            },
                            colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun VoiceSettingsDialog(
    initial: VoiceSettings,
    voices: List<VoiceOption>,
    onPreview: (VoiceSettings) -> Unit,
    onSave: (VoiceSettings) -> Unit,
    onDismiss: () -> Unit,
) {
    var draft by remember(initial) { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Voice settings") },
        text = {
            Column {
                VoiceSettingsEditor(
                    settings = draft,
                    voices = voices,
                    onVoice = { draft = draft.copy(voiceName = it) },
                    onRate = { draft = draft.copy(rate = it) },
                    onEnabled = { draft = draft.copy(enabled = it) },
                )
                TextButton(onClick = { onPreview(draft) }) { Text("Preview") }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(draft) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
